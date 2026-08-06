// Parish self-onboarding: POST /api/parish/start creates a parish and its
// first coordinator without an operator in the loop. This is what turns
// Ostiary from a one-parish tool into a commons.
//
// The anti-abuse posture is honest and simple: two creations per caller per
// day, twenty per day across everyone, counted in parish_starts. No captcha,
// no third-party service. If somebody burns the daily cap the answer is
// "ask again tomorrow", said in plain words, and the origin_note column gives
// a platform owner something to read when reviewing abuse.

import { ConfigError, hashPassphrase } from './auth';
import { clean, fail, json, newId, nowSeconds, readJson } from './http';
import type { Ctx, Env } from './http';

const PER_IP_PER_DAY = 2;
const GLOBAL_PER_DAY = 20;
const DAY_SECONDS = 86400;

const PAUSED_MESSAGE =
    'Creation is paused for the day. Ask again tomorrow, or open an issue on GitHub.';

// No 0/O/1/I, so a join code survives being handwritten on an index card and
// read back over the phone. Exactly 32 characters, which matters below:
// masking one random byte to 5 bits (b & 31) indexes it with zero modulo bias.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomFrom(length: number): string {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    let out = '';
    for (const b of bytes) out += ALPHABET[b & 31];
    return out;
}

/** Coordinator passphrase: four 5-character groups from the 32-character
 *  alphabet, e.g. "K7MPR-2WXJH-9DFGN-4TQVB". 20 characters at 5 bits each is
 *  100 bits of entropy, far past what PBKDF2 at 100,000 iterations (the
 *  Workers runtime cap, see auth.ts) needs to make offline guessing pointless.
 *  Chosen over a word list because the sign-in cookie lasts 30 days, so this
 *  is written down once and typed rarely; the coordinator can replace it with
 *  their own from the admin screen at any time. */
function generatePassphrase(): string {
    return [randomFrom(5), randomFrom(5), randomFrom(5), randomFrom(5)].join('-');
}

/** The raw caller IP is never stored. What lands in parish_starts.ip_hash is
 *  HMAC-SHA256(ip, SESSION_SECRET): enough to count "same caller today",
 *  useless as an address book. */
async function hashIp(env: Env, ip: string): Promise<string> {
    const secret = env.SESSION_SECRET;
    if (!secret || secret.length < 16) {
        throw new ConfigError('SESSION_SECRET is unset or too short');
    }
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(ip)));
    let hex = '';
    for (const b of sig) hex += b.toString(16).padStart(2, '0');
    return hex;
}

function callerIp(ctx: Ctx): string {
    // Cloudflare always sets CF-Connecting-IP in production. `wrangler pages
    // dev` sets it too; "local" is a last-resort bucket, not an expected path.
    return ctx.request.headers.get('CF-Connecting-IP') ?? 'local';
}

interface CapCounts { global_count: number; ip_count: number }

async function capsHaveRoom(ctx: Ctx): Promise<boolean> {
    const since = nowSeconds() - DAY_SECONDS;
    const ipHash = await hashIp(ctx.env, callerIp(ctx));
    const row = await ctx.env.DB.prepare(
        `SELECT
           (SELECT COUNT(*) FROM parish_starts WHERE created_at > ?1)                    AS global_count,
           (SELECT COUNT(*) FROM parish_starts WHERE created_at > ?1 AND ip_hash = ?2)   AS ip_count`,
    ).bind(since, ipHash).first<CapCounts>();
    if (!row) return false;
    return row.global_count < GLOBAL_PER_DAY && row.ip_count < PER_IP_PER_DAY;
}

/** A timezone is plausible when Intl accepts it. This is the whole test:
 *  the platform's own database decides, not a hand-kept list. */
function isValidTimezone(tz: string): boolean {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
    } catch {
        return false;
    }
}

function slugify(name: string): string {
    const s = name.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip combining accents
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    return s || 'parish';
}

async function uniqueSlug(ctx: Ctx, name: string): Promise<string> {
    const base = slugify(name);
    for (let n = 1; n <= 50; n++) {
        const candidate = n === 1 ? base : `${base}-${n}`;
        const taken = await ctx.env.DB.prepare(
            `SELECT 1 FROM parishes WHERE slug = ?1`,
        ).bind(candidate).first();
        if (!taken) return candidate;
    }
    throw new Error('No free slug after 50 attempts');
}

async function uniqueJoinCode(ctx: Ctx): Promise<string> {
    // 7 characters from a 32-character alphabet is 35 bits: collisions are
    // near-impossible at this scale, but checked anyway because a duplicate
    // join code would silently merge two parishes at sign-in.
    for (let i = 0; i < 20; i++) {
        const code = randomFrom(7);
        const taken = await ctx.env.DB.prepare(
            `SELECT 1 FROM parishes WHERE join_code = ?1`,
        ).bind(code).first();
        if (!taken) return code;
    }
    throw new Error('No free join code after 20 attempts');
}

/** GET /api/parish/start/health
 *  {open: true|false}: whether the daily caps have room, so the start page can
 *  say "paused for the day" before somebody fills in the whole form. No counts
 *  are leaked, deliberately; "how close is the cap" is nobody's business. */
export async function getParishStartHealth(ctx: Ctx): Promise<Response> {
    return json({ ok: true, open: await capsHaveRoom(ctx) });
}

interface StartBody {
    name?: string;
    city?: string;
    state?: string;
    country?: string;
    timezone?: string;
    coordinator_name?: string;
    coordinator_email?: string;
}

/** POST /api/parish/start
 *  { name, city?, state?, country?, timezone, coordinator_name,
 *    coordinator_email? }
 *  Creates the parish row and one coordinator usher, and returns the join code
 *  and the generated passphrase ONCE. The passphrase is stored only as a
 *  PBKDF2 hash; if it is lost before being written down, the parish row is an
 *  orphan and the honest remedy is starting over tomorrow. */
export async function postParishStart(ctx: Ctx): Promise<Response> {
    const body = await readJson<StartBody>(ctx.request);
    if (!body) return fail(400, 'Expected a JSON body.');

    // Validation first, caps second: a form mistake gets a form answer even on
    // a day the caps are spent. The health endpoint already told the page.
    const name = clean(body.name, 120);
    if (!name || name.length < 3) {
        return fail(400, 'Parish name must be 3 to 120 characters.');
    }

    const coordinatorName = clean(body.coordinator_name, 120);
    if (!coordinatorName) return fail(400, 'Coordinator name required.');

    const timezone = clean(body.timezone, 60);
    if (!timezone || !isValidTimezone(timezone)) {
        return fail(400, 'That is not a timezone this server recognizes. '
            + 'Use an IANA name like America/Chicago.');
    }

    const city = clean(body.city, 80);
    const state = clean(body.state, 80);
    const country = clean(body.country, 80);
    const coordinatorEmail = clean(body.coordinator_email, 200);

    if (!(await capsHaveRoom(ctx))) return fail(429, PAUSED_MESSAGE);

    const parishId = newId('par');
    const slug = await uniqueSlug(ctx, name);
    const joinCode = await uniqueJoinCode(ctx);
    const passphrase = generatePassphrase();
    const adminHash = await hashPassphrase(passphrase);
    const now = nowSeconds();

    const ipHash = await hashIp(ctx.env, callerIp(ctx));
    // The user-agent, truncated: not identity, just enough texture for a
    // platform owner reviewing a run of abusive creations.
    const originNote = (ctx.request.headers.get('User-Agent') ?? '').slice(0, 120) || null;

    // One batch so a half-created parish cannot exist. reviewed = 0: a
    // platform owner can later list unreviewed parishes; nothing gates on it.
    // state is stored as given or empty, never the schema's legacy 'CA'
    // default, which would claim a state nobody stated.
    await ctx.env.DB.batch([
        ctx.env.DB.prepare(
            `INSERT INTO parishes
               (id, slug, name, city, state, country, timezone, join_code,
                admin_hash, policy_notes, reviewed, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, '', 0, ?10, ?10)`,
        ).bind(parishId, slug, name, city, state ?? '', country, timezone,
            joinCode, adminHash, now),
        ctx.env.DB.prepare(
            `INSERT INTO ushers
               (id, parish_id, name, email, phone, role, languages, active,
                notes, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, NULL, 'coordinator', 'en', 1, NULL, ?5, ?5)`,
        ).bind(newId('ush'), parishId, coordinatorName, coordinatorEmail, now),
        ctx.env.DB.prepare(
            `INSERT INTO parish_starts (id, parish_id, ip_hash, origin_note, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)`,
        ).bind(newId('start'), parishId, ipHash, originNote, now),
    ]);

    // The only response that will ever contain this passphrase.
    return json({
        ok: true,
        parish: { name, slug },
        join_code: joinCode,
        passphrase,
    });
}
