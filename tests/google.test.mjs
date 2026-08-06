#!/usr/bin/env node
// Unit tests for the pure parts of the Google layer. No server needed:
//
//   node tests/google.test.mjs
//
// The .ts imports work because Node 22.18+ strips types natively; there is no
// build step to run first. Network-touching functions are tested against a
// mocked global fetch. Exits non-zero on the first tally with failures.

import {
    authUrl, decodeJwtClaims, decryptToken, encryptToken, exchangeCode,
    googleCreds, mapResponseStatus, validateIdClaims, GoogleApiError,
} from '../functions/_lib/google-api.ts';
import { signState, verifyState } from '../functions/_lib/auth.ts';

const ENV = { SESSION_SECRET: 'unit-test-secret-at-least-32-bytes-long' };
const NOW = Math.floor(Date.now() / 1000);

let passed = 0;
const failures = [];

function check(name, condition, detail = '') {
    if (condition) {
        passed++;
        console.log(`  ok   ${name}`);
    } else {
        failures.push(`${name}${detail ? ` :: ${detail}` : ''}`);
        console.log(`  FAIL ${name}${detail ? ` :: ${detail}` : ''}`);
    }
}

function b64url(obj) {
    return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

/** An unsigned JWT is enough here: the validator's job is claims, not
 *  signatures (the token arrives over TLS from Google's token endpoint). */
function fakeIdToken(claims) {
    return `${b64url({ alg: 'RS256' })}.${b64url(claims)}.fakesig`;
}

console.log('google unit tests\n');

// --- config ------------------------------------------------------------------
console.log('config');
{
    check('googleCreds null when unset', googleCreds({}) === null);
    check('googleCreds null when half set', googleCreds({ GOOGLE_CLIENT_ID: 'x' }) === null);
    const c = googleCreds({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's' });
    check('googleCreds returns both when set', c?.clientId === 'id' && c?.clientSecret === 's');
}

// --- auth URL ----------------------------------------------------------------
console.log('\nauth url');
{
    const url = new URL(authUrl({
        clientId: 'client-1', redirectUri: 'https://example.org/api/google/callback',
        scope: 'openid email profile', state: 'signed-state',
    }));
    check('points at Google', url.origin + url.pathname === 'https://accounts.google.com/o/oauth2/v2/auth');
    check('carries client_id', url.searchParams.get('client_id') === 'client-1');
    check('carries redirect_uri', url.searchParams.get('redirect_uri') === 'https://example.org/api/google/callback');
    check('carries scope', url.searchParams.get('scope') === 'openid email profile');
    check('carries state', url.searchParams.get('state') === 'signed-state');
    check('response_type is code', url.searchParams.get('response_type') === 'code');
    check('no offline params unless asked', !url.searchParams.has('access_type') && !url.searchParams.has('prompt'));

    const offline = new URL(authUrl({
        clientId: 'c', redirectUri: 'https://x/cb', scope: 's', state: 't', offline: true,
    }));
    check('offline adds access_type', offline.searchParams.get('access_type') === 'offline');
    check('offline forces consent (refresh token)', offline.searchParams.get('prompt') === 'consent');
}

// --- state HMAC --------------------------------------------------------------
console.log('\nstate');
{
    const token = await signState(ENV, { g: 'connect', p: 'parish-1' }, 600);
    const back = await verifyState(ENV, token);
    check('state round-trips', back?.g === 'connect' && back?.p === 'parish-1');
    check('state carries expiry', typeof back?.exp === 'number' && back.exp > NOW);

    const tampered = token.replace(/^./, (c) => (c === 'A' ? 'B' : 'A'));
    check('tampered state is rejected', (await verifyState(ENV, tampered)) === null);
    check('wrong key is rejected',
        (await verifyState({ SESSION_SECRET: 'a-completely-different-secret-key!!' }, token)) === null);

    const expired = await signState(ENV, { g: 'signin' }, -10);
    check('expired state is rejected', (await verifyState(ENV, expired)) === null);
    check('null state is rejected', (await verifyState(ENV, null)) === null);
}

// --- refresh-token crypto ----------------------------------------------------
console.log('\ntoken crypto');
{
    const secret = ENV.SESSION_SECRET;
    const sealed = await encryptToken(secret, '1//refresh-token-value');
    check('iv is 12 bytes', Buffer.from(sealed.iv, 'base64').length === 12);
    check('round-trips', (await decryptToken(secret, sealed.iv, sealed.ciphertext)) === '1//refresh-token-value');

    const again = await encryptToken(secret, '1//refresh-token-value');
    check('a fresh IV every time', again.iv !== sealed.iv || again.ciphertext !== sealed.ciphertext);

    check('rotated SESSION_SECRET reads as null, not garbage',
        (await decryptToken('rotated-secret-thirty-two-bytes!!', sealed.iv, sealed.ciphertext)) === null);

    const bad = Buffer.from(sealed.ciphertext, 'base64');
    bad[0] ^= 0xff;
    check('tampered ciphertext reads as null',
        (await decryptToken(secret, sealed.iv, bad.toString('base64'))) === null);
}

// --- id-token validation -----------------------------------------------------
console.log('\nid token');
{
    const good = {
        aud: 'client-1', iss: 'https://accounts.google.com', exp: NOW + 3600,
        sub: 'sub-123', email: 'Usher@Example.org', email_verified: true,
    };
    const claims = decodeJwtClaims(fakeIdToken(good));
    check('claims decode from the JWT body', claims?.sub === 'sub-123');

    const v = validateIdClaims(claims, 'client-1', NOW);
    check('valid claims pass', v.ok === true);
    check('email is lowercased', v.ok && v.email === 'usher@example.org');

    check('aud mismatch fails',
        validateIdClaims({ ...good, aud: 'other-client' }, 'client-1', NOW).ok === false);
    check('iss mismatch fails',
        validateIdClaims({ ...good, iss: 'https://evil.example' }, 'client-1', NOW).ok === false);
    check('bare accounts.google.com iss passes',
        validateIdClaims({ ...good, iss: 'accounts.google.com' }, 'client-1', NOW).ok === true);
    check('expired token fails',
        validateIdClaims({ ...good, exp: NOW - 10 }, 'client-1', NOW).ok === false);
    check('unverified email fails',
        validateIdClaims({ ...good, email_verified: false }, 'client-1', NOW).ok === false);
    check('missing email fails',
        validateIdClaims({ ...good, email: undefined }, 'client-1', NOW).ok === false);
    check('null claims fail', validateIdClaims(null, 'client-1', NOW).ok === false);
    check('garbage jwt decodes to null', decodeJwtClaims('not.a.jwt') === null);
}

// --- rsvp mapping ------------------------------------------------------------
console.log('\nrsvp mapping');
{
    check('accepted is yes', mapResponseStatus('accepted') === 'yes');
    check('declined is no', mapResponseStatus('declined') === 'no');
    check('tentative is maybe', mapResponseStatus('tentative') === 'maybe');
    check('needsAction is left alone', mapResponseStatus('needsAction') === null);
    check('unknown is left alone', mapResponseStatus('whatever') === null);
    check('missing is left alone', mapResponseStatus(undefined) === null);
}

// --- code exchange (mocked fetch) -------------------------------------------
console.log('\ncode exchange');
{
    const realFetch = globalThis.fetch;
    const creds = { clientId: 'client-1', clientSecret: 'secret-1' };

    let sent = null;
    globalThis.fetch = async (url, init) => {
        sent = { url: String(url), body: new URLSearchParams(init.body) };
        return new Response(JSON.stringify({ access_token: 'at', id_token: 'it' }), {
            status: 200, headers: { 'Content-Type': 'application/json' },
        });
    };
    const tokens = await exchangeCode(creds, 'auth-code', 'https://x/cb');
    check('posts to the token endpoint', sent.url === 'https://oauth2.googleapis.com/token');
    check('sends the code and grant type',
        sent.body.get('code') === 'auth-code'
        && sent.body.get('grant_type') === 'authorization_code'
        && sent.body.get('redirect_uri') === 'https://x/cb');
    check('returns the token payload', tokens.access_token === 'at');

    globalThis.fetch = async () => new Response(
        JSON.stringify({ error: 'invalid_grant', error_description: 'Code was already redeemed.' }),
        { status: 400 },
    );
    let thrown = null;
    try { await exchangeCode(creds, 'used-code', 'https://x/cb'); } catch (err) { thrown = err; }
    check('a Google error surfaces as GoogleApiError', thrown instanceof GoogleApiError);
    check('with Google\'s own explanation, not a fake success',
        thrown?.message === 'Code was already redeemed.' && thrown?.status === 400);

    globalThis.fetch = realFetch;
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
}
