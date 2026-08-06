// Shared request/response plumbing for the Ostiary API.

import { COOKIE_NAME, ConfigError, readCookie, verifySession } from './auth';
import type { Session } from './auth';

export interface Env {
    DB: D1Database;
    SESSION_SECRET?: string;
    // Optional. When unset, every /api/google/* route answers 503 and the rest
    // of the app behaves exactly as it did before the Google layer existed.
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
}

export interface Ctx {
    request: Request;
    env: Env;
    url: URL;
    /** Path after /api/, e.g. "roster/signup". */
    route: string;
    session: Session | null;
}

const JSON_HEADERS = {
    'Content-Type': 'application/json; charset=utf-8',
    // API responses are per-session. Never let an edge or browser cache reuse
    // one usher's roster for another.
    'Cache-Control': 'no-store',
};

export function json(data: unknown, init: ResponseInit = {}): Response {
    const headers = new Headers(init.headers);
    for (const [k, v] of Object.entries(JSON_HEADERS)) headers.set(k, v);
    return new Response(JSON.stringify(data), { ...init, headers });
}

export function fail(status: number, message: string, extra: Record<string, unknown> = {}) {
    return json({ ok: false, error: message, ...extra }, { status });
}

export function ok(data: Record<string, unknown> = {}) {
    return json({ ok: true, ...data });
}

/** True when the request arrived over https, so cookies get the Secure flag.
 *  `wrangler pages dev` serves plain http on localhost; forcing Secure there
 *  would silently drop every cookie and look like a broken login. */
export function isSecure(url: URL): boolean {
    return url.protocol === 'https:';
}

export async function readJson<T>(request: Request): Promise<T | null> {
    if (request.headers.get('Content-Type')?.includes('application/json') !== true) return null;
    try {
        return (await request.json()) as T;
    } catch {
        return null;
    }
}

export async function loadSession(request: Request, env: Env): Promise<Session | null> {
    return verifySession(env, readCookie(request, COOKIE_NAME));
}

/** Guard for any route that needs a signed-in usher. */
export function requireUsher(ctx: Ctx): Response | null {
    if (!ctx.session) return fail(401, 'Sign in with your parish code first.');
    return null;
}

/** Guard for coordinator-only routes. Checks the proven-admin flag, not the
 *  role column: a coordinator who only picked their name off the roster has
 *  not entered the passphrase and must not get write access. */
export function requireAdmin(ctx: Ctx): Response | null {
    if (!ctx.session) return fail(401, 'Sign in first.');
    if (ctx.session.a !== 1) return fail(403, 'Coordinator passphrase required.');
    return null;
}

export function handleConfigError(err: unknown): Response | null {
    if (err instanceof ConfigError) {
        return fail(503, 'Server is not configured. SESSION_SECRET is missing.');
    }
    return null;
}

export function nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
}

export function newId(prefix: string): string {
    return `${prefix}-${crypto.randomUUID()}`;
}

/** Trim, collapse whitespace, cap length. Applied to every free-text field
 *  before it reaches D1. */
export function clean(value: unknown, maxLength: number): string | null {
    if (typeof value !== 'string') return null;
    const s = value.replace(/\s+/g, ' ').trim();
    if (!s) return null;
    return s.slice(0, maxLength);
}
