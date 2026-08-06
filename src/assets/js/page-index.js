/* Page script for index.html. Extracted from an inline <script> so the
   Content-Security-Policy in _headers can use script-src 'self' with no
   'unsafe-inline'. An inline script would force the policy open for every
   injected string on the page. */

import { api, state, requireSession, signOut, fmtDateTime, relativeDay, esc,
         $, say, showError, clearError } from '/assets/js/app.js';

const signinEl = $('#signin');
const dashEl = $('#dash');

/* --- signed-out flow ---------------------------------------------------- */

let parishCode = null;

/* Google sign-in: the button appears only when the server says Google is
   configured, so a parish that never set it up never sees a dead control.
   The callback reports failures as a short code in the query string. */
const GOOGLE_MESSAGES = {
    'no-match': 'That Google account is not on a roster yet. Ask your coordinator '
        + 'to add your email, then try again. The parish code still works below.',
    'many-match': 'That email appears more than once across rosters, so Google '
        + 'sign-in cannot tell who you are. Sign in with the parish code instead.',
    denied: 'Google sign-in was cancelled. The parish code still works.',
    error: 'Google sign-in did not complete. Try again, or use the parish code.',
};

async function showGoogleSignin() {
    try {
        await api('google/status');
        $('#googleSignin').hidden = false;
    } catch { /* 503: not configured. The button stays hidden, honestly. */ }
}

function reportGoogleResult() {
    const params = new URLSearchParams(location.search);
    const code = params.get('google');
    if (!code) return;
    history.replaceState(null, '', location.pathname);
    if (GOOGLE_MESSAGES[code]) showError(new Error(GOOGLE_MESSAGES[code]));
}

$('#codeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    const code = $('#code').value.trim().toUpperCase();
    if (!code) return;
    try {
        const data = await api(`parish?code=${encodeURIComponent(code)}`);
        parishCode = code;
        $('#parishName').textContent = data.parish.name;
        const sel = $('#usher');
        sel.innerHTML = '<option value="">Choose your name</option>' +
            data.ushers.map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('');
        $('#whoCard').hidden = false;
        say(`${data.parish.name} found. Choose your name.`);
        sel.focus();
    } catch (err) {
        showError(err);
        $('#code').focus();
    }
});

$('#usherForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    const usherId = $('#usher').value;
    if (!usherId) { showError(new Error('Choose your name first.')); return; }
    try {
        await api('session', { method: 'POST', body: { code: parishCode, usher_id: usherId } });
        location.reload();
    } catch (err) { showError(err); }
});

$('#adminForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    const passphrase = $('#passphrase').value;
    if (!passphrase) { showError(new Error('Enter the passphrase.')); return; }
    try {
        await api('session', { method: 'POST', body: { code: parishCode, passphrase } });
        location.reload();
    } catch (err) {
        showError(err);
        $('#passphrase').select();
    }
});

/* --- signed-in dashboard ------------------------------------------------ */

async function paintDashboard() {
    if (state.me.admin) $('#adminLink').hidden = false;

    // Roster: the soonest slot this person is actually on.
    try {
        const { slots } = await api('roster?days=42');
        const mine = slots.filter((s) => s.my_status && s.my_status !== 'dropped');
        const box = $('#nextSlot');
        if (!mine.length) {
            box.innerHTML = `<p class="muted">You are not signed up for anything yet.</p>`;
        } else {
            const s = mine[0];
            const rel = relativeDay(s.starts_at);
            box.innerHTML = `
              <p><strong>${esc(s.label)}</strong><br>
                 ${esc(fmtDateTime(s.starts_at))}${rel ? ` <span class="muted">(${rel})</span>` : ''}</p>
              ${s.unconfirmed_time
                ? '<p class="pill warn">! Time not confirmed</p>' : ''}
              <p class="small muted">${s.filled} of ${s.ushers_needed} ushers signed up.</p>`;
        }
    } catch (err) { showError(err); }

    // Formation progress.
    try {
        const { modules } = await api('formation');
        const done = modules.filter((m) => m.progress).length;
        const pct = Math.round((done / modules.length) * 100);
        const next = modules.find((m) => !m.progress);
        $('#formationSummary').innerHTML = `
          <p><strong>${done} of ${modules.length}</strong> modules complete.</p>
          <div class="progress-track" role="img"
               aria-label="${done} of ${modules.length} modules complete">
            <div class="progress-fill" style="width:${pct}%"></div>
          </div>
          ${next ? `<p class="small muted" style="margin-top:.6rem;">Next up: ${esc(next.title)}</p>`
                 : '<p class="small muted" style="margin-top:.6rem;">All modules complete.</p>'}`;
    } catch (err) { showError(err); }

    // Next meeting.
    try {
        const { meetings } = await api('meetings');
        const box = $('#nextMeeting');
        if (!meetings.length) {
            box.innerHTML = '<p class="muted">Nothing scheduled.</p>';
        } else {
            const m = meetings[0];
            box.innerHTML = `
              <p><strong>${esc(m.title)}</strong><br>
                 ${esc(fmtDateTime(m.starts_at))}${m.location ? ` at ${esc(m.location)}` : ''}</p>
              <p class="small muted">${m.counts.yes} coming, ${m.counts.no} cannot,
                 ${m.counts.maybe} unsure.
                 ${m.my_rsvp ? `You said <strong>${esc(m.my_rsvp)}</strong>.` : 'You have not replied.'}</p>`;
        }
    } catch (err) { showError(err); }
}

$('#signOut').addEventListener('click', () => signOut().catch(showError));

/* --- boot --------------------------------------------------------------- */

try {
    state.me = await api('me');
    dashEl.hidden = false;
    $('#identity').textContent =
        `${state.me.usher ? state.me.usher.name : 'Coordinator'}` +
        `${state.me.admin ? ' (coordinator)' : ''} at ${state.me.parish.name}`;
    await paintDashboard();
} catch (err) {
    if (err.status === 401) {
        signinEl.hidden = false;
        $('#code').focus();
    } else {
        signinEl.hidden = false;
        showError(err);
    }
    reportGoogleResult();
    showGoogleSignin();
}
