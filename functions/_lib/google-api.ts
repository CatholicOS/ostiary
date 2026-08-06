// Talking to Google: OAuth endpoints, token crypto, and the small pure
// functions the routes are built from. Nothing in this file touches D1 or the
// request context, which is what makes it unit-testable under plain node
// (tests/google.test.mjs imports it directly).

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
export const CLOUD_IDENTITY_API = 'https://cloudidentity.googleapis.com/v1';

// Sign-in identifies a person. Connect additionally asks for calendar writes,
// and, only when the coordinator opts in, Workspace group management.
export const SCOPE_SIGNIN = 'openid email profile';
export const SCOPE_CALENDAR = 'https://www.googleapis.com/auth/calendar.events';
export const SCOPE_GROUPS = 'https://www.googleapis.com/auth/cloud-identity.groups';

export interface GoogleCreds {
    clientId: string;
    clientSecret: string;
}

/** Both env vars, or null. Callers turn null into the honest 503. */
export function googleCreds(env: {
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
}): GoogleCreds | null {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
    return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
}

// ---------------------------------------------------------------------------
// Pure pieces
// ---------------------------------------------------------------------------

/** The consent-screen URL. `offline` adds access_type=offline and
 *  prompt=consent so Google returns a refresh token, which it otherwise only
 *  does on the very first consent for a client. */
export function authUrl(o: {
    clientId: string;
    redirectUri: string;
    scope: string;
    state: string;
    offline?: boolean;
}): string {
    const p = new URLSearchParams({
        client_id: o.clientId,
        redirect_uri: o.redirectUri,
        response_type: 'code',
        scope: o.scope,
        state: o.state,
    });
    if (o.offline) {
        p.set('access_type', 'offline');
        p.set('prompt', 'consent');
    }
    return `${GOOGLE_AUTH_URL}?${p.toString()}`;
}

/** Decode a JWT's claims without verifying its signature. Only ever called on
 *  an id_token this server just received from Google's token endpoint over
 *  TLS, where per OIDC Core 3.1.3.7 the channel itself authenticates the
 *  token. We chose local decoding over the tokeninfo endpoint because the
 *  token never passed through the browser, so a signature (and therefore a
 *  JWKS fetch or an extra tokeninfo round trip) proves nothing the TLS
 *  connection has not already proven. aud/iss/exp are still checked. */
export function decodeJwtClaims(jwt: string | undefined): Record<string, unknown> | null {
    if (!jwt) return null;
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    try {
        const pad = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
        const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
        return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    } catch {
        return null;
    }
}

export type IdClaimCheck =
    | { ok: true; email: string; sub: string }
    | { ok: false; reason: string };

/** aud, iss, exp, and a verified email. Everything else is not our business. */
export function validateIdClaims(
    claims: Record<string, unknown> | null,
    clientId: string,
    nowSeconds: number,
): IdClaimCheck {
    if (!claims) return { ok: false, reason: 'no claims' };
    if (claims.aud !== clientId) return { ok: false, reason: 'aud mismatch' };
    if (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com') {
        return { ok: false, reason: 'iss mismatch' };
    }
    if (typeof claims.exp !== 'number' || claims.exp < nowSeconds) {
        return { ok: false, reason: 'expired' };
    }
    if (typeof claims.sub !== 'string' || !claims.sub) return { ok: false, reason: 'no sub' };
    if (typeof claims.email !== 'string' || !claims.email.includes('@')) {
        return { ok: false, reason: 'no email' };
    }
    if (claims.email_verified !== true && claims.email_verified !== 'true') {
        return { ok: false, reason: 'email not verified' };
    }
    return { ok: true, email: claims.email.toLowerCase(), sub: claims.sub };
}

/** Calendar attendee responseStatus to Ostiary RSVP. needsAction maps to
 *  null, meaning "leave whatever they said in Ostiary alone": an unanswered
 *  invite is not a no. */
export function mapResponseStatus(s: string | undefined): 'yes' | 'no' | 'maybe' | null {
    if (s === 'accepted') return 'yes';
    if (s === 'declined') return 'no';
    if (s === 'tentative') return 'maybe';
    return null;
}

// ---------------------------------------------------------------------------
// Refresh-token encryption
// AES-256-GCM under a key derived from SESSION_SECRET with HKDF-SHA256 and
// the info string "ostiary-google-token". Deriving rather than reusing keeps
// the HMAC key and the encryption key cryptographically separate. The
// consequence, stated plainly: rotating SESSION_SECRET invalidates every
// stored refresh token. That is fine. The coordinator presses Connect again.
// ---------------------------------------------------------------------------

const enc = new TextEncoder();

function toB64(bytes: Uint8Array): string {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
}

function fromB64(s: string): Uint8Array {
    const bin = atob(s);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function tokenKey(secret: string): Promise<CryptoKey> {
    const material = await crypto.subtle.importKey(
        'raw', enc.encode(secret), 'HKDF', false, ['deriveKey'],
    );
    return crypto.subtle.deriveKey(
        {
            name: 'HKDF', hash: 'SHA-256',
            salt: new Uint8Array(0), info: enc.encode('ostiary-google-token'),
        },
        material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
    );
}

export async function encryptToken(
    secret: string, plaintext: string,
): Promise<{ iv: string; ciphertext: string }> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await tokenKey(secret);
    const ct = new Uint8Array(
        await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext)),
    );
    return { iv: toB64(iv), ciphertext: toB64(ct) };
}

/** Null on any failure: wrong key (SESSION_SECRET rotated), tampered
 *  ciphertext, or garbage columns. The caller says "reconnect", not "bug". */
export async function decryptToken(
    secret: string, ivB64: string, ciphertextB64: string,
): Promise<string | null> {
    try {
        const key = await tokenKey(secret);
        const pt = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: fromB64(ivB64) }, key, fromB64(ciphertextB64),
        );
        return new TextDecoder().decode(pt);
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

export class GoogleApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

/** Parse a Google response, or throw a GoogleApiError carrying whatever
 *  explanation Google gave. Never invents success. */
async function googleJson(res: Response): Promise<Record<string, unknown>> {
    const text = await res.text();
    let data: Record<string, unknown> | null = null;
    try {
        data = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch { /* non-JSON error body; fall through to the status line */ }
    if (!res.ok) {
        const err = data?.error as Record<string, unknown> | string | undefined;
        const message =
            (typeof data?.error_description === 'string' && data.error_description) ||
            (typeof err === 'object' && typeof err?.message === 'string' && err.message) ||
            (typeof err === 'string' && err) ||
            `Google returned HTTP ${res.status}.`;
        throw new GoogleApiError(res.status, message);
    }
    return data ?? {};
}

export interface TokenResponse {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    scope?: string;
}

export async function exchangeCode(
    creds: GoogleCreds, code: string, redirectUri: string,
): Promise<TokenResponse> {
    const res = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            code,
            client_id: creds.clientId,
            client_secret: creds.clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
        }),
    });
    return (await googleJson(res)) as TokenResponse;
}

/** Mint an access token from the stored refresh token. Workers are stateless
 *  between requests, so there is nowhere sane to cache this; one extra round
 *  trip per Google-touching request is the honest price. */
export async function refreshAccessToken(
    creds: GoogleCreds, refreshToken: string,
): Promise<string> {
    const res = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            refresh_token: refreshToken,
            client_id: creds.clientId,
            client_secret: creds.clientSecret,
            grant_type: 'refresh_token',
        }),
    });
    const data = await googleJson(res);
    if (typeof data.access_token !== 'string') {
        throw new GoogleApiError(502, 'Google returned no access token.');
    }
    return data.access_token;
}

/** Authenticated JSON call to a Google API. 204 returns null. */
export async function apiCall(
    accessToken: string, method: string, url: string, body?: unknown,
): Promise<Record<string, unknown> | null> {
    const res = await fetch(url, {
        method,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    return googleJson(res);
}
