// Session cookies and passphrase verification for Ostiary.
//
// Cookie is base64url(payload).base64url(HMAC-SHA256(payload)). No JWT library:
// we need exactly one algorithm and one key, and a dependency here would be
// more attack surface than code.
//
// There is no default SESSION_SECRET. If the binding is missing, every
// authenticated route fails closed with 503. A fallback secret would let anyone
// who read this repository forge a coordinator session.

export interface Session {
    /** parish id */ p: string;
    /** usher id */  u: string;
    /** role */      r: 'usher' | 'captain' | 'coordinator';
    /** admin session (passphrase proven), not merely a roster pick */ a: 0 | 1;
    /** expiry, unix seconds */ exp: number;
}

export const COOKIE_NAME = 'ostiary_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const PBKDF2_HASH = 'SHA-256';

export class ConfigError extends Error {}

const enc = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
    const pad = s.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function b64ToBytes(s: string): Uint8Array {
    const bin = atob(s);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Constant-time compare. Length is not secret here, contents are. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
    return crypto.subtle.importKey(
        'raw', enc.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
    );
}

function requireSecret(env: { SESSION_SECRET?: string }): string {
    const s = env.SESSION_SECRET;
    if (!s || s.length < 16) {
        throw new ConfigError('SESSION_SECRET is unset or too short');
    }
    return s;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export async function signSession(
    env: { SESSION_SECRET?: string },
    session: Omit<Session, 'exp'>,
): Promise<string> {
    const payload: Session = {
        ...session,
        exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    };
    const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
    const key = await hmacKey(requireSecret(env));
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body)));
    return `${body}.${b64urlEncode(sig)}`;
}

export async function verifySession(
    env: { SESSION_SECRET?: string },
    token: string | null,
): Promise<Session | null> {
    if (!token) return null;
    const dot = token.lastIndexOf('.');
    if (dot <= 0) return null;

    const body = token.slice(0, dot);
    const sig = token.slice(dot + 1);

    const key = await hmacKey(requireSecret(env));
    const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body)));

    let given: Uint8Array;
    try {
        given = b64urlDecode(sig);
    } catch {
        return null;
    }
    if (!timingSafeEqual(expected, given)) return null;

    try {
        const parsed = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as Session;
        if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) return null;
        if (!parsed.p || !parsed.u) return null;
        return parsed;
    } catch {
        return null;
    }
}

export function readCookie(request: Request, name: string): string | null {
    const header = request.headers.get('Cookie');
    if (!header) return null;
    for (const part of header.split(';')) {
        const [k, ...rest] = part.trim().split('=');
        if (k === name) return rest.join('=');
    }
    return null;
}

export function sessionCookie(token: string, secure: boolean): string {
    const attrs = [
        `${COOKIE_NAME}=${token}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${SESSION_TTL_SECONDS}`,
    ];
    if (secure) attrs.push('Secure');
    return attrs.join('; ');
}

export function clearCookie(secure: boolean): string {
    const attrs = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
    if (secure) attrs.push('Secure');
    return attrs.join('; ');
}

// ---------------------------------------------------------------------------
// Passphrases
// ---------------------------------------------------------------------------

/** Verify against "iterations:saltB64:hashB64" as written by scripts/seed.mjs. */
export async function verifyPassphrase(plain: string, stored: string | null): Promise<boolean> {
    if (!stored) return false;
    const [iterStr, saltB64, hashB64] = stored.split(':');
    const iterations = Number(iterStr);
    if (!iterations || !saltB64 || !hashB64) return false;

    const salt = b64ToBytes(saltB64);
    const expected = b64ToBytes(hashB64);

    const material = await crypto.subtle.importKey(
        'raw', enc.encode(plain), 'PBKDF2', false, ['deriveBits'],
    );
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations, hash: PBKDF2_HASH },
        material, expected.length * 8,
    );
    return timingSafeEqual(new Uint8Array(bits), expected);
}

export async function hashPassphrase(plain: string, iterations = 210000): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const material = await crypto.subtle.importKey(
        'raw', enc.encode(plain), 'PBKDF2', false, ['deriveBits'],
    );
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations, hash: PBKDF2_HASH }, material, 256,
    );
    const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
    return `${iterations}:${toB64(salt)}:${toB64(new Uint8Array(bits))}`;
}
