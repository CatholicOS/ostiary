// Google routes: sign-in (OIDC), the coordinator's Connect flow, and the
// connection record itself. The reconcile jobs that use the connection live in
// google-sync.ts.
//
// Everything Google is optional per parish. With GOOGLE_CLIENT_ID and
// GOOGLE_CLIENT_SECRET unset, every route here answers 503 in plain words and
// the rest of the app behaves exactly as it did before this file existed. The
// join-code sign-in is untouched and remains the fallback.

import { signSession, signState, verifyState, sessionCookie } from './auth';
import { fail, isSecure, nowSeconds, ok, readJson, requireAdmin } from './http';
import type { Ctx, Env } from './http';
import {
    GOOGLE_REVOKE_URL, SCOPE_CALENDAR, SCOPE_GROUPS, SCOPE_SIGNIN,
    authUrl, decodeJwtClaims, decryptToken, encryptToken, exchangeCode,
    googleCreds, refreshAccessToken, validateIdClaims, isOwnerEmail,
} from './google-api';
import type { GoogleCreds, TokenResponse } from './google-api';

/** OAuth state payloads. Keys are terse like the session's: g = goal,
 *  p = parish id, exp is added by signState. */
interface SigninState extends Record<string, unknown> { g: 'signin'; }
interface ConnectState extends Record<string, unknown> { g: 'connect'; p: string; }

const STATE_TTL_SECONDS = 600;

export interface ConnectionRow {
    parish_id: string;
    connected_email: string;
    refresh_token_ciphertext: string;
    refresh_token_iv: string;
    scopes: string;
    calendar_id: string;
    group_email: string | null;
}

function notConfigured(): Response {
    return fail(503, 'Google is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
}

function redirect(to: string, extraHeaders: Record<string, string> = {}): Response {
    return new Response(null, { status: 302, headers: { Location: to, ...extraHeaders } });
}

/** One redirect URI for both flows, derived from the request origin so local
 *  dev and production register the same path, not the same host. */
function redirectUri(ctx: Ctx): string {
    return `${ctx.url.origin}/api/google/callback`;
}

export async function googleConnection(ctx: Ctx): Promise<ConnectionRow | null> {
    if (!ctx.session) return null;
    return ctx.env.DB.prepare(
        `SELECT parish_id, connected_email, refresh_token_ciphertext, refresh_token_iv,
                scopes, calendar_id, group_email
         FROM google_connections WHERE parish_id = ?1`,
    ).bind(ctx.session.p).first<ConnectionRow>();
}

/** Decrypt the stored refresh token and mint an access token. Throws
 *  GoogleApiError from the refresh call; returns null only when the stored
 *  token cannot be decrypted, which means SESSION_SECRET changed and the
 *  coordinator has to reconnect. */
export async function accessTokenFor(env: Env, creds: GoogleCreds, row: ConnectionRow):
    Promise<string | null> {
    const refresh = await decryptToken(
        env.SESSION_SECRET ?? '', row.refresh_token_iv, row.refresh_token_ciphertext,
    );
    if (!refresh) return null;
    return refreshAccessToken(creds, refresh);
}

export const RECONNECT_MESSAGE =
    'The stored Google token cannot be read, most likely because SESSION_SECRET '
    + 'was rotated. Disconnect and connect Google again.';

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/** GET /api/google/status
 *  Anyone may ask whether Google sign-in exists at all (the sign-in page needs
 *  to know before showing the button). Connection details are coordinator-only. */
export async function getGoogleStatus(ctx: Ctx): Promise<Response> {
    if (!googleCreds(ctx.env)) return notConfigured();
    if (!ctx.session || ctx.session.a !== 1) return ok({ configured: true });

    const row = await googleConnection(ctx);
    return ok({
        configured: true,
        connected: !!row,
        connected_email: row?.connected_email ?? null,
        calendar_id: row?.calendar_id ?? null,
        group_email: row?.group_email ?? null,
        groups_scope: row ? row.scopes.includes(SCOPE_GROUPS) : false,
    });
}

// ---------------------------------------------------------------------------
// Sign in with Google (ushers and coordinators)
// ---------------------------------------------------------------------------

/** GET /api/google/signin
 *  The signed state is pure CSRF armor: the callback only proceeds when the
 *  round trip through Google comes back with something we signed minutes ago. */
export async function getGoogleSignin(ctx: Ctx): Promise<Response> {
    const creds = googleCreds(ctx.env);
    if (!creds) return notConfigured();

    const state = await signState(ctx.env, { g: 'signin' } satisfies SigninState, STATE_TTL_SECONDS);
    return redirect(authUrl({
        clientId: creds.clientId, redirectUri: redirectUri(ctx),
        scope: SCOPE_SIGNIN, state,
    }));
}

// ---------------------------------------------------------------------------
// Coordinator Connect (calendar invites + Meet, optionally group sync)
// ---------------------------------------------------------------------------

/** GET /api/google/connect[?groups=1]
 *  Coordinator only. Asks for offline access so Google hands back a refresh
 *  token this parish can keep. The groups scope is opt-in because it is
 *  meaningless outside Google Workspace and would only add consent-screen
 *  noise for a plain gmail.com parish. */
export async function getGoogleConnect(ctx: Ctx): Promise<Response> {
    const guard = requireAdmin(ctx); if (guard) return guard;
    const creds = googleCreds(ctx.env);
    if (!creds) return notConfigured();

    const withGroups = ctx.url.searchParams.get('groups') === '1';
    const scope = `openid email ${SCOPE_CALENDAR}${withGroups ? ` ${SCOPE_GROUPS}` : ''}`;
    const state = await signState(
        ctx.env, { g: 'connect', p: ctx.session!.p } satisfies ConnectState, STATE_TTL_SECONDS,
    );
    return redirect(authUrl({
        clientId: creds.clientId, redirectUri: redirectUri(ctx),
        scope, state, offline: true,
    }));
}

// ---------------------------------------------------------------------------
// Callback (both flows)
// ---------------------------------------------------------------------------

/** GET /api/google/callback
 *  A browser navigation, not an XHR, so failures redirect to the page that
 *  started the flow with a short code the page turns into plain words. */
export async function getGoogleCallback(ctx: Ctx): Promise<Response> {
    const creds = googleCreds(ctx.env);
    if (!creds) return notConfigured();

    const state = await verifyState<SigninState | ConnectState>(
        ctx.env, ctx.url.searchParams.get('state'),
    );
    if (!state) return redirect('/?google=error');
    const dest = state.g === 'connect' ? '/admin' : '/';

    if (ctx.url.searchParams.get('error')) return redirect(`${dest}?google=denied`);
    const code = ctx.url.searchParams.get('code');
    if (!code) return redirect(`${dest}?google=error`);

    let tokens: TokenResponse;
    try {
        tokens = await exchangeCode(creds, code, redirectUri(ctx));
    } catch (err) {
        console.error('google code exchange failed', err);
        return redirect(`${dest}?google=error`);
    }

    const check = validateIdClaims(decodeJwtClaims(tokens.id_token), creds.clientId, nowSeconds());
    if (!check.ok) {
        console.error('google id token rejected:', check.reason);
        return redirect(`${dest}?google=error`);
    }

    return state.g === 'connect'
        ? finishConnect(ctx, state, tokens, check.email)
        : finishSignin(ctx, check.email, check.sub);
}

/** Sign-in completes only for an email already on a roster. Exactly one active
 *  match issues the same session cookie the join-code flow issues, with the
 *  admin flag at 0: Google proves who you are, not coordinator authority. The
 *  passphrase remains the only admin credential, with one stated exception:
 *  an email on the OWNER_EMAILS allowlist signs in with coordinator
 *  authority, because a verified Google identity is a stronger credential
 *  than the passphrase it replaces. Nobody is ever auto-created. */
async function finishSignin(ctx: Ctx, email: string, sub: string): Promise<Response> {
    const { results } = await ctx.env.DB.prepare(
        `SELECT id, parish_id, role, google_sub FROM ushers
         WHERE lower(email) = ?1 AND active = 1`,
    ).bind(email).all<{
        id: string; parish_id: string;
        role: 'usher' | 'captain' | 'coordinator'; google_sub: string | null;
    }>();

    if (!results || results.length === 0) return redirect('/?google=no-match');
    if (results.length > 1) return redirect('/?google=many-match');

    const usher = results[0];
    if (!usher.google_sub) {
        await ctx.env.DB.prepare(
            `UPDATE ushers SET google_sub = ?2, updated_at = ?3
             WHERE id = ?1 AND google_sub IS NULL`,
        ).bind(usher.id, sub, nowSeconds()).run();
    }

    const token = await signSession(ctx.env, {
        p: usher.parish_id, u: usher.id, r: usher.role,
        a: isOwnerEmail(ctx.env.OWNER_EMAILS, email) ? 1 : 0,
    });
    return redirect('/', { 'Set-Cookie': sessionCookie(token, isSecure(ctx.url)) });
}

/** The coordinator's session cookie rode along on the redirect (SameSite=Lax
 *  permits top-level GET navigation), so the callback can insist the person
 *  finishing the flow is the same proven coordinator who started it. */
async function finishConnect(
    ctx: Ctx, state: ConnectState, tokens: TokenResponse, email: string,
): Promise<Response> {
    if (!ctx.session || ctx.session.a !== 1 || ctx.session.p !== state.p) {
        return redirect('/admin?google=error');
    }
    if (!tokens.refresh_token) return redirect('/admin?google=norefresh');

    const sealed = await encryptToken(ctx.env.SESSION_SECRET ?? '', tokens.refresh_token);
    const now = nowSeconds();
    await ctx.env.DB.prepare(
        `INSERT INTO google_connections
           (parish_id, connected_email, refresh_token_ciphertext, refresh_token_iv,
            scopes, calendar_id, group_email, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'primary', NULL, ?6, ?6)
         ON CONFLICT (parish_id) DO UPDATE SET
           connected_email = ?2, refresh_token_ciphertext = ?3,
           refresh_token_iv = ?4, scopes = ?5, updated_at = ?6`,
    ).bind(state.p, email, sealed.ciphertext, sealed.iv, tokens.scope ?? '', now).run();

    return redirect('/admin?google=connected');
}

// ---------------------------------------------------------------------------
// Disconnect and group email
// ---------------------------------------------------------------------------

/** POST /api/google/disconnect
 *  Revocation at Google is best-effort: the row is gone either way, and a
 *  refresh token we no longer hold is dead weight, revoked or not. */
export async function postGoogleDisconnect(ctx: Ctx): Promise<Response> {
    const guard = requireAdmin(ctx); if (guard) return guard;
    if (!googleCreds(ctx.env)) return notConfigured();

    const row = await googleConnection(ctx);
    if (!row) return fail(404, 'Google is not connected.');

    const refresh = await decryptToken(
        ctx.env.SESSION_SECRET ?? '', row.refresh_token_iv, row.refresh_token_ciphertext,
    );
    if (refresh) {
        try {
            await fetch(GOOGLE_REVOKE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ token: refresh }),
            });
        } catch { /* best-effort; the delete below is what matters */ }
    }

    await ctx.env.DB.prepare(
        `DELETE FROM google_connections WHERE parish_id = ?1`,
    ).bind(ctx.session!.p).run();
    return ok({ disconnected: true });
}

/** POST /api/google/group { group_email }
 *  Stores the Workspace group to reconcile. Empty string clears it. */
export async function postGoogleGroup(ctx: Ctx): Promise<Response> {
    const guard = requireAdmin(ctx); if (guard) return guard;
    if (!googleCreds(ctx.env)) return notConfigured();

    const body = await readJson<{ group_email?: string }>(ctx.request);
    if (!body) return fail(400, 'Expected a JSON body.');

    const raw = typeof body.group_email === 'string' ? body.group_email.trim().toLowerCase() : '';
    if (raw && !raw.includes('@')) return fail(400, 'That does not look like a group email.');

    const res = await ctx.env.DB.prepare(
        `UPDATE google_connections SET group_email = ?2, updated_at = ?3 WHERE parish_id = ?1`,
    ).bind(ctx.session!.p, raw || null, nowSeconds()).run();
    if (!res.meta.changes) return fail(400, 'Connect Google first, then set the group email.');

    return ok({ group_email: raw || null });
}
