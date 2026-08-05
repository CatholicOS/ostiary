/* Page script for roster.html. Extracted from an inline <script> so the
   Content-Security-Policy in _headers can use script-src 'self' with no
   'unsafe-inline'. An inline script would force the policy open for every
   injected string on the page. */

import { api, state, requireSession, fmtDateTime, relativeDay, esc,
         $, $$, say, showError, clearError, askText } from '/assets/js/app.js';

let slots = [];
let filter = 'all';

const LABEL = {
    assigned: 'Signed up',
    confirmed: 'Confirmed',
    sub_requested: 'Needs a sub',
};

function visible() {
    if (filter === 'mine') return slots.filter((s) => s.my_status && s.my_status !== 'dropped');
    if (filter === 'short') return slots.filter((s) => s.short_by > 0 || s.assignments.some((a) => a.status === 'sub_requested'));
    return slots;
}

function slotMarkup(s) {
    const mine = s.my_status && s.my_status !== 'dropped';
    const subs = s.assignments.filter((a) => a.status === 'sub_requested');
    const rel = relativeDay(s.starts_at);

    const classes = ['slot'];
    if (mine) classes.push('mine');
    else if (s.short_by > 0) classes.push('short');

    // A <ul> cannot live inside a <p>, so the wrapper is a div. The list stays
    // a real list so a screen reader announces "list, 4 items" rather than
    // reading a comma-separated run-on.
    const people = s.assignments.length
        ? `<div class="names">On this Mass:
             <ul>${s.assignments.map((a) =>
                `<li>${esc(a.name)}${a.status === 'sub_requested' ? ' (needs a sub)' : ''}</li>`).join('')}</ul></div>`
        : '<p class="names muted">Nobody signed up yet.</p>';

    // Every action is a real button with an accessible name that includes the
    // Mass, so a screen-reader user tabbing through a long roster always knows
    // which Mass a "Sign up" applies to.
    const actions = [];
    if (!mine) {
        actions.push(`<button type="button" class="primary" data-act="signup" data-slot="${esc(s.id)}">
            Sign up<span class="sr-only"> for ${esc(s.label)} on ${esc(fmtDateTime(s.starts_at))}</span></button>`);
    } else {
        actions.push(`<button type="button" data-act="drop" data-slot="${esc(s.id)}">
            Drop<span class="sr-only"> ${esc(s.label)} on ${esc(fmtDateTime(s.starts_at))}</span></button>`);
        if (s.my_status !== 'sub_requested') {
            actions.push(`<button type="button" data-act="sub" data-slot="${esc(s.id)}">
                Request a sub<span class="sr-only"> for ${esc(s.label)}</span></button>`);
        }
    }
    for (const a of subs) {
        if (a.usher_id === state.me?.usher?.id) continue;
        actions.push(`<button type="button" data-act="cover" data-slot="${esc(s.id)}"
            data-usher="${esc(a.usher_id)}">Cover for ${esc(a.name)}</button>`);
    }

    return `<article class="${classes.join(' ')}">
      <div class="row between">
        <div>
          <h3${s.language !== 'en' ? ` lang="${esc(s.language)}"` : ''}>${esc(s.label)}</h3>
          <p class="when">${esc(fmtDateTime(s.starts_at))}${rel ? ` (${rel})` : ''}
             ${s.language !== 'en' ? `<span class="pill plain">${esc(s.language.toUpperCase())}</span>` : ''}</p>
        </div>
        <div class="row">
          ${mine ? `<span class="pill ok">&#10003; ${esc(LABEL[s.my_status] || s.my_status)}</span>` : ''}
          ${s.unconfirmed_time ? '<span class="pill warn">! Time unconfirmed</span>' : ''}
          ${s.short_by > 0
            ? `<span class="pill warn">! Short ${s.short_by}</span>`
            : `<span class="pill plain">${s.filled} of ${s.ushers_needed}</span>`}
        </div>
      </div>
      ${people}
      <div class="row" style="margin-top:.7rem;">${actions.join('')}</div>
    </article>`;
}

function render() {
    const list = visible();

    // One summary, not one banner per slot. Eight seeded Sundays produce
    // seventeen unconfirmed Masses, and seventeen identical red boxes stop
    // being a warning and become wallpaper. Say it once, with the count, and
    // leave a compact pill on each row.
    const unconfirmed = slots.filter((s) => s.unconfirmed_time).length;
    $('#unconfirmedBanner').innerHTML = unconfirmed
        ? `<p class="banner"><strong>${unconfirmed} of these Mass times
             ${unconfirmed === 1 ? 'has' : 'have'} not been confirmed.</strong>
             They were seeded as placeholders. A coordinator needs to check them against
             the parish schedule before anyone relies on them. Each one is marked
             <span class="pill warn">! Time unconfirmed</span> below.</p>`
        : '';

    const box = $('#slots');
    if (!list.length) {
        box.innerHTML = `<div class="card"><p class="muted">
            ${filter === 'all' ? 'No Masses scheduled in the next six weeks.'
                               : 'Nothing matches that filter.'}</p></div>`;
        return;
    }
    box.innerHTML = list.map(slotMarkup).join('');
}

async function load() {
    try {
        clearError();
        const data = await api('roster?days=42');
        slots = data.slots;
        render();
    } catch (err) { showError(err); }
}

$('#slots').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const { act, slot, usher } = btn.dataset;
    btn.disabled = true;
    try {
        clearError();
        if (act === 'signup') {
            await api('roster/signup', { method: 'POST', body: { slot_id: slot } });
            say('Signed up.');
        } else if (act === 'drop') {
            await api('roster/drop', { method: 'POST', body: { slot_id: slot } });
            say('Dropped.');
        } else if (act === 'sub') {
            const slotInfo = slots.find((x) => x.id === slot);
            const reason = await askText({
                title: 'Request a sub',
                label: 'Anything the coordinator should know?',
                hint: `For ${slotInfo ? slotInfo.label : 'this Mass'}. Optional.`,
                confirmLabel: 'Request a sub',
            });
            // null means cancelled. An empty string means "no reason given",
            // which is a real answer and still submits.
            if (reason === null) { btn.disabled = false; return; }
            await api('roster/sub', { method: 'POST', body: { slot_id: slot, reason } });
            say('Sub requested.');
        } else if (act === 'cover') {
            await api('roster/cover', { method: 'POST', body: { slot_id: slot, usher_id: usher } });
            say('You are covering that Mass.');
        }
        await load();
    } catch (err) {
        showError(err);
        btn.disabled = false;
    }
});

$('#printBtn').addEventListener('click', () => window.print());

for (const [id, value] of [['filterAll', 'all'], ['filterMine', 'mine'], ['filterShort', 'short']]) {
    $(`#${id}`).addEventListener('click', () => {
        filter = value;
        for (const b of $$('[aria-pressed]')) b.setAttribute('aria-pressed', String(b.id === id));
        render();
        say(`Showing ${value === 'all' ? 'all Masses' : value === 'mine' ? 'your Masses' : 'short-handed Masses'}.`);
    });
}

if (await requireSession()) await load();
