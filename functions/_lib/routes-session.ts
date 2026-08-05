// Sign-in, sign-out, and "who am I".

import { signSession, sessionCookie, clearCookie, verifyPassphrase } from './auth';
import { clean, fail, isSecure, json, ok, readJson } from './http';
import type { Ctx } from './http';

interface ParishRow {
    id: string; slug: string; name: string; city: string | null;
    timezone: string; admin_hash: string | null; policy_notes: string | null;
}

interface UsherRow {
    id: string; name: string; role: 'usher' | 'captain' | 'coordinator';
    languages: string; email: string | null;
}

async function parishByCode(ctx: Ctx, code: string): Promise<ParishRow | null> {
    return ctx.env.DB.prepare(
        `SELECT id, slug, name, city, timezone, admin_hash, policy_notes
         FROM parishes WHERE join_code = ?1`,
    ).bind(code).first<ParishRow>();
}

/** GET /api/parish?code=CLEMENT
 *  Lets the sign-in screen show the roster to pick a name from. Returns names
 *  only. Emails and phone numbers are never exposed to an unauthenticated
 *  caller, because the join code is a low-security shared secret. */
export async function getParishForSignIn(ctx: Ctx): Promise<Response> {
    const code = clean(ctx.url.searchParams.get('code'), 40);
    if (!code) return fail(400, 'Parish code required.');

    const parish = await parishByCode(ctx, code.toUpperCase());
    if (!parish) return fail(404, 'No parish with that code.');

    const { results } = await ctx.env.DB.prepare(
        `SELECT id, name, role FROM ushers
         WHERE parish_id = ?1 AND active = 1 ORDER BY name`,
    ).bind(parish.id).all<Pick<UsherRow, 'id' | 'name' | 'role'>>();

    return json({
        ok: true,
        parish: { name: parish.name, city: parish.city, timezone: parish.timezone },
        ushers: results ?? [],
    });
}

/** POST /api/session  { code, usher_id }            -> usher session
 *  POST /api/session  { code, passphrase }          -> coordinator session */
export async function postSession(ctx: Ctx): Promise<Response> {
    const body = await readJson<{ code?: string; usher_id?: string; passphrase?: string }>(
        ctx.request,
    );
    if (!body) return fail(400, 'Expected a JSON body.');

    const code = clean(body.code, 40)?.toUpperCase();
    if (!code) return fail(400, 'Parish code required.');

    const parish = await parishByCode(ctx, code);
    if (!parish) return fail(404, 'No parish with that code.');

    // --- coordinator path -------------------------------------------------
    if (body.passphrase) {
        const good = await verifyPassphrase(String(body.passphrase), parish.admin_hash);
        if (!good) return fail(401, 'That passphrase is not right.');

        // Attach the session to a coordinator on the roster so admin actions
        // are attributable. If none exists yet, fall back to the parish id.
        const coord = await ctx.env.DB.prepare(
            `SELECT id, name, role, languages, email FROM ushers
             WHERE parish_id = ?1 AND role = 'coordinator' AND active = 1
             ORDER BY created_at LIMIT 1`,
        ).bind(parish.id).first<UsherRow>();

        const token = await signSession(ctx.env, {
            p: parish.id, u: coord?.id ?? parish.id, r: 'coordinator', a: 1,
        });
        return json(
            { ok: true, admin: true, parish: { name: parish.name, timezone: parish.timezone },
              usher: coord ? { id: coord.id, name: coord.name, role: coord.role } : null },
            { headers: { 'Set-Cookie': sessionCookie(token, isSecure(ctx.url)) } },
        );
    }

    // --- usher path -------------------------------------------------------
    const usherId = clean(body.usher_id, 80);
    if (!usherId) return fail(400, 'Pick your name, or enter the coordinator passphrase.');

    const usher = await ctx.env.DB.prepare(
        `SELECT id, name, role, languages, email FROM ushers
         WHERE id = ?1 AND parish_id = ?2 AND active = 1`,
    ).bind(usherId, parish.id).first<UsherRow>();

    if (!usher) {
        return fail(403, 'That name is not on the roster. Ask your coordinator to add you.');
    }

    const token = await signSession(ctx.env, {
        p: parish.id, u: usher.id, r: usher.role, a: 0,
    });
    return json(
        { ok: true, admin: false, parish: { name: parish.name, timezone: parish.timezone },
          usher: { id: usher.id, name: usher.name, role: usher.role } },
        { headers: { 'Set-Cookie': sessionCookie(token, isSecure(ctx.url)) } },
    );
}

/** DELETE /api/session */
export function deleteSession(ctx: Ctx): Response {
    return json({ ok: true }, { headers: { 'Set-Cookie': clearCookie(isSecure(ctx.url)) } });
}

/** GET /api/me */
export async function getMe(ctx: Ctx): Promise<Response> {
    if (!ctx.session) return fail(401, 'Not signed in.');

    const parish = await ctx.env.DB.prepare(
        `SELECT id, slug, name, city, timezone, admin_hash, policy_notes
         FROM parishes WHERE id = ?1`,
    ).bind(ctx.session.p).first<ParishRow>();
    if (!parish) return fail(404, 'Parish no longer exists.');

    const usher = await ctx.env.DB.prepare(
        `SELECT id, name, role, languages, email FROM ushers WHERE id = ?1`,
    ).bind(ctx.session.u).first<UsherRow>();

    return ok({
        admin: ctx.session.a === 1,
        parish: {
            name: parish.name, city: parish.city, timezone: parish.timezone,
            policy_notes: parish.policy_notes,
        },
        usher: usher
            ? { id: usher.id, name: usher.name, role: usher.role, languages: usher.languages }
            : null,
    });
}
