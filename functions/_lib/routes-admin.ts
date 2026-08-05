// Coordinator-only writes. Every handler is gated by requireAdmin, which
// checks the proven-passphrase flag rather than the role column.

import { hashPassphrase } from './auth';
import { clean, fail, newId, nowSeconds, ok, readJson, requireAdmin } from './http';
import type { Ctx } from './http';

const ROLES = ['usher', 'captain', 'coordinator'];

/** POST /api/admin/usher { id?, name, email?, phone?, role?, languages?, active? } */
export async function postUsher(ctx: Ctx): Promise<Response> {
    const guard = requireAdmin(ctx); if (guard) return guard;

    const body = await readJson<Record<string, unknown>>(ctx.request);
    if (!body) return fail(400, 'Expected a JSON body.');

    const name = clean(body.name, 120);
    if (!name) return fail(400, 'Name required.');

    const role = clean(body.role, 20) ?? 'usher';
    if (!ROLES.includes(role)) return fail(400, `role must be one of ${ROLES.join(', ')}.`);

    const email = clean(body.email, 200);
    const phone = clean(body.phone, 40);
    const languages = clean(body.languages, 60) ?? 'en';
    const active = body.active === false ? 0 : 1;
    const now = nowSeconds();
    const id = clean(body.id, 80);

    if (id) {
        const res = await ctx.env.DB.prepare(
            `UPDATE ushers SET name = ?3, email = ?4, phone = ?5, role = ?6,
                    languages = ?7, active = ?8, updated_at = ?9
             WHERE id = ?1 AND parish_id = ?2`,
        ).bind(id, ctx.session!.p, name, email, phone, role, languages, active, now).run();
        if (!res.meta.changes) return fail(404, 'No such usher at your parish.');
        return ok({ id });
    }

    const newUsherId = newId('ush');
    await ctx.env.DB.prepare(
        `INSERT INTO ushers (id, parish_id, name, email, phone, role, languages, active, notes, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9, ?9)`,
    ).bind(newUsherId, ctx.session!.p, name, email, phone, role, languages, active, now).run();

    return ok({ id: newUsherId });
}

/** POST /api/admin/slot { id?, starts_at, label, language?, ushers_needed?, notes?, confirm_time? }
 *  starts_at is unix seconds UTC. The client converts from the parish timezone;
 *  the server never guesses a zone. */
export async function postSlot(ctx: Ctx): Promise<Response> {
    const guard = requireAdmin(ctx); if (guard) return guard;

    const body = await readJson<Record<string, unknown>>(ctx.request);
    if (!body) return fail(400, 'Expected a JSON body.');

    const id = clean(body.id, 80);

    // Confirming a seeded placeholder time is its own action, so a coordinator
    // can clear the "unconfirmed" warning without retyping the whole slot.
    if (id && body.confirm_time === true && body.starts_at === undefined) {
        const res = await ctx.env.DB.prepare(
            `UPDATE mass_slots SET unconfirmed_time = 0, notes = NULL
             WHERE id = ?1 AND parish_id = ?2`,
        ).bind(id, ctx.session!.p).run();
        if (!res.meta.changes) return fail(404, 'No such Mass at your parish.');
        return ok({ id, unconfirmed_time: false });
    }

    const startsAt = Number(body.starts_at);
    if (!Number.isFinite(startsAt) || startsAt <= 0) {
        return fail(400, 'starts_at must be unix seconds.');
    }
    const label = clean(body.label, 120);
    if (!label) return fail(400, 'Label required.');

    const language = clean(body.language, 10) ?? 'en';
    const needed = Math.min(Math.max(Number(body.ushers_needed) || 4, 1), 30);
    const notes = clean(body.notes, 300);
    const unconfirmed = body.confirm_time === true ? 0 : 1;
    const now = nowSeconds();

    if (id) {
        const res = await ctx.env.DB.prepare(
            `UPDATE mass_slots SET starts_at = ?3, label = ?4, language = ?5,
                    ushers_needed = ?6, notes = ?7, unconfirmed_time = ?8
             WHERE id = ?1 AND parish_id = ?2`,
        ).bind(id, ctx.session!.p, startsAt, label, language, needed, notes, unconfirmed).run();
        if (!res.meta.changes) return fail(404, 'No such Mass at your parish.');
        return ok({ id });
    }

    const slotId = newId('slot');
    await ctx.env.DB.prepare(
        `INSERT INTO mass_slots (id, parish_id, starts_at, label, language, ushers_needed, notes, unconfirmed_time, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    ).bind(slotId, ctx.session!.p, startsAt, label, language, needed, notes, unconfirmed, now).run();

    return ok({ id: slotId });
}

/** DELETE /api/admin/slot?id=... */
export async function deleteSlot(ctx: Ctx): Promise<Response> {
    const guard = requireAdmin(ctx); if (guard) return guard;

    const id = clean(ctx.url.searchParams.get('id'), 80);
    if (!id) return fail(400, 'id required.');

    const res = await ctx.env.DB.prepare(
        `DELETE FROM mass_slots WHERE id = ?1 AND parish_id = ?2`,
    ).bind(id, ctx.session!.p).run();
    if (!res.meta.changes) return fail(404, 'No such Mass at your parish.');
    return ok({ id, deleted: true });
}

/** POST /api/admin/meeting { id?, starts_at, title, location?, agenda_md?, minutes_md? } */
export async function postMeeting(ctx: Ctx): Promise<Response> {
    const guard = requireAdmin(ctx); if (guard) return guard;

    const body = await readJson<Record<string, unknown>>(ctx.request);
    if (!body) return fail(400, 'Expected a JSON body.');

    const title = clean(body.title, 160);
    if (!title) return fail(400, 'Title required.');

    const startsAt = Number(body.starts_at);
    if (!Number.isFinite(startsAt) || startsAt <= 0) {
        return fail(400, 'starts_at must be unix seconds.');
    }

    const location = clean(body.location, 160);
    // Agenda and minutes are long-form; collapse-whitespace would destroy the
    // line breaks, so they are trimmed and length-capped only.
    const agenda = typeof body.agenda_md === 'string' ? body.agenda_md.trim().slice(0, 8000) : null;
    const minutes = typeof body.minutes_md === 'string' ? body.minutes_md.trim().slice(0, 20000) : null;
    const now = nowSeconds();
    const id = clean(body.id, 80);

    if (id) {
        const res = await ctx.env.DB.prepare(
            `UPDATE meetings SET starts_at = ?3, title = ?4, location = ?5,
                    agenda_md = ?6, minutes_md = ?7, updated_at = ?8
             WHERE id = ?1 AND parish_id = ?2`,
        ).bind(id, ctx.session!.p, startsAt, title, location, agenda, minutes, now).run();
        if (!res.meta.changes) return fail(404, 'No such meeting at your parish.');
        return ok({ id });
    }

    const meetingId = newId('mtg');
    await ctx.env.DB.prepare(
        `INSERT INTO meetings (id, parish_id, starts_at, title, location, agenda_md, minutes_md, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)`,
    ).bind(meetingId, ctx.session!.p, startsAt, title, location, agenda, minutes, now).run();

    return ok({ id: meetingId });
}

/** POST /api/admin/attendance { meeting_id, present: string[] }
 *  Replaces the attended flags for one meeting in a single batch. */
export async function postAttendance(ctx: Ctx): Promise<Response> {
    const guard = requireAdmin(ctx); if (guard) return guard;

    const body = await readJson<{ meeting_id?: string; present?: string[] }>(ctx.request);
    const meetingId = clean(body?.meeting_id, 80);
    if (!meetingId) return fail(400, 'meeting_id required.');

    const meeting = await ctx.env.DB.prepare(
        `SELECT id FROM meetings WHERE id = ?1 AND parish_id = ?2`,
    ).bind(meetingId, ctx.session!.p).first<{ id: string }>();
    if (!meeting) return fail(404, 'No such meeting at your parish.');

    const present = Array.isArray(body?.present) ? body!.present!.slice(0, 500) : [];
    const now = nowSeconds();

    const statements = [
        ctx.env.DB.prepare(
            `UPDATE meeting_rsvps SET attended = 0, updated_at = ?2 WHERE meeting_id = ?1`,
        ).bind(meetingId, now),
    ];
    for (const usherId of present) {
        const id = clean(usherId, 80);
        if (!id) continue;
        // Upsert: somebody who never RSVP'd can still be marked present.
        statements.push(
            ctx.env.DB.prepare(
                `INSERT INTO meeting_rsvps (id, meeting_id, usher_id, status, attended, updated_at)
                 SELECT ?1, ?2, ?3, 'maybe', 1, ?4
                 WHERE EXISTS (SELECT 1 FROM ushers WHERE id = ?3 AND parish_id = ?5)
                 ON CONFLICT (meeting_id, usher_id)
                 DO UPDATE SET attended = 1, updated_at = ?4`,
            ).bind(newId('rsvp'), meetingId, id, now, ctx.session!.p),
        );
    }
    await ctx.env.DB.batch(statements);

    return ok({ meeting_id: meetingId, present: present.length });
}

/** POST /api/admin/parish { policy_notes?, passphrase? }
 *  policy_notes is what fills the gap the flagged formation modules leave open. */
export async function postParish(ctx: Ctx): Promise<Response> {
    const guard = requireAdmin(ctx); if (guard) return guard;

    const body = await readJson<Record<string, unknown>>(ctx.request);
    if (!body) return fail(400, 'Expected a JSON body.');

    const now = nowSeconds();

    if (typeof body.policy_notes === 'string') {
        await ctx.env.DB.prepare(
            `UPDATE parishes SET policy_notes = ?2, updated_at = ?3 WHERE id = ?1`,
        ).bind(ctx.session!.p, body.policy_notes.trim().slice(0, 10000), now).run();
    }

    if (typeof body.passphrase === 'string') {
        const pass = body.passphrase;
        if (pass.length < 10) return fail(400, 'Passphrase must be at least 10 characters.');
        await ctx.env.DB.prepare(
            `UPDATE parishes SET admin_hash = ?2, updated_at = ?3 WHERE id = ?1`,
        ).bind(ctx.session!.p, await hashPassphrase(pass), now).run();
    }

    return ok({});
}
