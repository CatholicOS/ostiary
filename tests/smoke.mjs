#!/usr/bin/env node
// End-to-end smoke test against a running `npm run dev`.
//
//   npm run setup:local
//   npm run dev            # in another shell, port 8793
//   BASE=http://127.0.0.1:8793 node tests/smoke.mjs
//
// Exercises the real HTTP surface with real cookies, so an auth regression or a
// broken route shows up here rather than in a browser. Exits non-zero on the
// first failure.

const BASE = process.env.BASE || 'http://127.0.0.1:8793';
const CODE = process.env.OSTIARY_JOIN_CODE || 'CLEMENT';
const PASS = process.env.OSTIARY_ADMIN_PASSPHRASE || 'local-dev-passphrase';

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

/** Minimal cookie jar. Keeps one session per jar so the usher and coordinator
 *  flows cannot contaminate each other. */
function jar() {
    let cookie = '';
    return {
        get header() { return cookie ? { Cookie: cookie } : {}; },
        capture(res) {
            const set = res.headers.get('set-cookie');
            if (set) cookie = set.split(';')[0];
        },
    };
}

async function call(path, { method = 'GET', body, jar: j } = {}) {
    const headers = { ...(j ? j.header : {}) };
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${BASE}/api/${path}`, {
        method, headers, body: body ? JSON.stringify(body) : undefined,
    });
    if (j) j.capture(res);
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON body */ }
    return { status: res.status, data };
}

console.log(`Ostiary smoke test against ${BASE}\n`);

// --- public ----------------------------------------------------------------
console.log('public');
{
    const r = await call(`parish?code=${CODE}`);
    check('parish lookup by join code', r.status === 200 && r.data?.ok, `status ${r.status}`);
    check('roster of names returned', Array.isArray(r.data?.ushers) && r.data.ushers.length > 0);
    check('no emails leak to unauthenticated callers',
        !JSON.stringify(r.data ?? {}).includes('@'),
        'an email address appeared in the sign-in payload');

    const bad = await call('parish?code=NOPE-NOT-A-PARISH');
    check('unknown code is 404', bad.status === 404, `status ${bad.status}`);

    const anon = await call('me');
    check('me is 401 when signed out', anon.status === 401, `status ${anon.status}`);

    const anonRoster = await call('roster');
    check('roster is 401 when signed out', anonRoster.status === 401, `status ${anonRoster.status}`);
}

// --- usher -----------------------------------------------------------------
console.log('\nusher');
const usher = jar();
let firstSlot = null;
{
    const list = await call(`parish?code=${CODE}`);
    const target = list.data.ushers.find((u) => u.role !== 'coordinator') ?? list.data.ushers[0];

    const login = await call('session', {
        method: 'POST', body: { code: CODE, usher_id: target.id }, jar: usher,
    });
    check('usher sign-in', login.status === 200 && login.data?.ok, `status ${login.status}`);
    check('usher session is not admin', login.data?.admin === false);

    const me = await call('me', { jar: usher });
    check('me returns the signed-in usher', me.data?.usher?.id === target.id);

    const roster = await call('roster?days=42', { jar: usher });
    check('roster returns slots', roster.data?.slots?.length > 0, `got ${roster.data?.slots?.length}`);
    firstSlot = roster.data?.slots?.[0];
    check('roster exposes the unconfirmed-time flag',
        typeof firstSlot?.unconfirmed_time === 'boolean',
        'the flag is missing entirely, so the UI cannot warn about placeholder times');

    const signup = await call('roster/signup', {
        method: 'POST', body: { slot_id: firstSlot.id }, jar: usher,
    });
    check('sign up for a Mass', signup.status === 200 && signup.data?.ok);

    const again = await call('roster/signup', {
        method: 'POST', body: { slot_id: firstSlot.id }, jar: usher,
    });
    check('sign-up is idempotent', again.status === 200 && again.data?.ok);

    const after = await call('roster?days=42', { jar: usher });
    const mine = after.data.slots.find((s) => s.id === firstSlot.id);
    check('sign-up shows on the roster', mine?.my_status === 'assigned', `got ${mine?.my_status}`);
    check('filled count incremented', mine?.filled >= 1);

    const sub = await call('roster/sub', {
        method: 'POST', body: { slot_id: firstSlot.id, reason: 'Out of town' }, jar: usher,
    });
    check('request a sub', sub.status === 200 && sub.data?.status === 'sub_requested');

    const drop = await call('roster/drop', {
        method: 'POST', body: { slot_id: firstSlot.id }, jar: usher,
    });
    check('drop a Mass', drop.status === 200 && drop.data?.status === 'dropped');

    // Dropping twice is a no-op, not an error: the button is idempotent so a
    // double tap on a slow connection does not surface a scary failure. The
    // guard that matters is the next one, where no assignment ever existed.
    const dropAgain = await call('roster/drop', {
        method: 'POST', body: { slot_id: firstSlot.id }, jar: usher,
    });
    check('dropping twice is idempotent', dropAgain.status === 200);

    const neverOn = await call('roster/drop', {
        method: 'POST', body: { slot_id: 'slot-does-not-exist' }, jar: usher,
    });
    check('dropping a Mass you were never on is 404, not a silent success',
        neverOn.status === 404, `status ${neverOn.status}`);

    const ghost = await call('roster/signup', {
        method: 'POST', body: { slot_id: 'slot-does-not-exist' }, jar: usher,
    });
    check('signing up for a foreign slot is 404', ghost.status === 404);
}

// --- formation -------------------------------------------------------------
console.log('\nformation');
{
    const f = await call('formation', { jar: usher });
    check('formation returns 8 modules', f.data?.modules?.length === 8, `got ${f.data?.modules?.length}`);

    const leaks = JSON.stringify(f.data.modules.map((m) => m.check));
    check('self-check answers are not sent to the client',
        !leaks.includes('"answer"') && !leaks.includes('"why"'),
        'the answer key was included in the module payload');

    // Four modules describe practice that is diocesan or parish specific and
    // must not be answered by this app: the collection, communion (low-gluten
    // host provisions vary parish to parish), emergencies, and safe environment.
    const gapped = f.data.modules.filter((m) => m.policy_gap).map((m) => m.slug).sort();
    check('policy-gap modules are flagged',
        JSON.stringify(gapped) ===
            JSON.stringify(['collection', 'communion', 'emergencies', 'safe-environment']),
        `got ${gapped.join(',')}`);

    const mod = f.data.modules[0];
    const wrong = await call('formation/complete', {
        method: 'POST', body: { module_slug: mod.slug, answers: [99, 99] }, jar: usher,
    });
    check('a wrong self-check still completes', wrong.status === 200 && wrong.data?.ok);
    check('wrong answers score zero', wrong.data?.score === 0, `got ${wrong.data?.score}`);
    check('feedback explains each answer',
        wrong.data?.feedback?.every((x) => typeof x.why === 'string' && x.why.length > 0));

    const after = await call('formation', { jar: usher });
    check('progress is recorded',
        after.data.modules.find((m) => m.slug === mod.slug)?.progress != null);

    const denied = await call('formation/status', { jar: usher });
    check('formation status is coordinator-only', denied.status === 403, `status ${denied.status}`);
}

// --- meetings --------------------------------------------------------------
console.log('\nmeetings');
{
    const m = await call('meetings', { jar: usher });
    check('meetings load', m.status === 200 && Array.isArray(m.data?.meetings));

    if (m.data.meetings.length) {
        const rsvp = await call('meetings/rsvp', {
            method: 'POST', body: { meeting_id: m.data.meetings[0].id, status: 'yes' }, jar: usher,
        });
        check('rsvp saves', rsvp.status === 200 && rsvp.data?.status === 'yes');

        const bad = await call('meetings/rsvp', {
            method: 'POST', body: { meeting_id: m.data.meetings[0].id, status: 'perhaps' }, jar: usher,
        });
        check('invalid rsvp status is rejected', bad.status === 400);

        const foreign = await call('meetings/rsvp', {
            method: 'POST', body: { meeting_id: 'mtg-not-ours', status: 'yes' }, jar: usher,
        });
        check('rsvp to a foreign meeting is 404', foreign.status === 404);
    }
}

// --- admin -----------------------------------------------------------------
console.log('\nadmin');
{
    const denied = await call('admin/usher', {
        method: 'POST', body: { name: 'Should Not Exist' }, jar: usher,
    });
    check('usher session cannot write to admin', denied.status === 403, `status ${denied.status}`);

    const admin = jar();
    const badPass = await call('session', {
        method: 'POST', body: { code: CODE, passphrase: 'wrong-passphrase' }, jar: admin,
    });
    check('wrong passphrase is rejected', badPass.status === 401, `status ${badPass.status}`);

    const login = await call('session', {
        method: 'POST', body: { code: CODE, passphrase: PASS }, jar: admin,
    });
    check('coordinator sign-in', login.status === 200 && login.data?.admin === true,
        `status ${login.status}`);

    const created = await call('admin/usher', {
        method: 'POST',
        body: { name: 'Smoke Test Usher', role: 'usher', languages: 'en,es' },
        jar: admin,
    });
    check('coordinator can add an usher', created.status === 200 && created.data?.id);

    const status = await call('formation/status', { jar: admin });
    check('coordinator sees formation status', status.status === 200 && status.data?.ushers?.length > 0);

    const when = Math.floor(Date.now() / 1000) + 7 * 86400;
    const slot = await call('admin/slot', {
        method: 'POST',
        body: { label: 'Smoke Test Mass', starts_at: when, ushers_needed: 2, confirm_time: true },
        jar: admin,
    });
    check('coordinator can add a Mass', slot.status === 200 && slot.data?.id);

    const roster = await call('roster?days=42', { jar: admin });
    const added = roster.data.slots.find((s) => s.id === slot.data.id);
    check('a coordinator-entered time is confirmed by definition',
        added?.unconfirmed_time === false, `got ${added?.unconfirmed_time}`);

    // The placeholder lifecycle is tested on a slot this run creates, so the
    // suite is idempotent. Asserting it against a seeded slot would pass once
    // and then fail on every later run, because confirming is a one-way door.
    const placeholder = await call('admin/slot', {
        method: 'POST',
        body: { label: 'Smoke Test Placeholder', starts_at: when + 3600, confirm_time: false },
        jar: admin,
    });
    check('a slot created without confirm_time is flagged unconfirmed',
        placeholder.status === 200);
    const withPlaceholder = await call('roster?days=42', { jar: admin });
    const ph = withPlaceholder.data.slots.find((s) => s.id === placeholder.data.id);
    check('the unconfirmed flag reaches the roster', ph?.unconfirmed_time === true,
        `got ${ph?.unconfirmed_time}`);

    const confirmed = await call('admin/slot', {
        method: 'POST', body: { id: placeholder.data.id, confirm_time: true }, jar: admin,
    });
    check('confirming a placeholder time clears the flag',
        confirmed.status === 200 && confirmed.data?.unconfirmed_time === false);

    for (const id of [slot.data.id, placeholder.data.id]) {
        const del = await call(`admin/slot?id=${encodeURIComponent(id)}`, {
            method: 'DELETE', jar: admin,
        });
        check(`coordinator can delete a Mass (${id.slice(0, 12)})`,
            del.status === 200 && del.data?.deleted);
    }

    const shortPass = await call('admin/parish', {
        method: 'POST', body: { passphrase: 'short' }, jar: admin,
    });
    check('a too-short passphrase is rejected', shortPass.status === 400);

    const notes = await call('admin/parish', {
        method: 'POST', body: { policy_notes: 'AED is in the vestibule.' }, jar: admin,
    });
    check('coordinator can save policy notes', notes.status === 200 && notes.data?.ok);

    const seen = await call('formation', { jar: usher });
    check('policy notes reach the ushers', seen.data?.policy_notes?.includes('AED'));
}

// --- session teardown ------------------------------------------------------
console.log('\nsession');
{
    const out = await call('session', { method: 'DELETE', jar: usher });
    check('sign out returns ok', out.status === 200);

    const bogus = jar();
    bogus.capture({ headers: { get: () => 'ostiary_session=forged.signature; Path=/' } });
    const forged = await call('me', { jar: bogus });
    check('a forged cookie is rejected', forged.status === 401, `status ${forged.status}`);

    const noRoute = await call('does-not-exist');
    check('unknown route is 404', noRoute.status === 404);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
}
