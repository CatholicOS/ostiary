/* Page script for start.html: parish self-onboarding.
   External module, like every page script, so the CSP can stay script-src
   'self' with no 'unsafe-inline'. */

import { api, esc, $, say, showError, clearError } from '/assets/js/app.js';

/* --- timezone select ----------------------------------------------------- */

/* Common US and Canadian zones. Anything else goes through "Other", a free
   IANA name the server validates with Intl, so no parish on earth is locked
   out by this list being short. */
const ZONES = [
    ['America/New_York', 'Eastern (US): New York'],
    ['America/Chicago', 'Central (US): Chicago'],
    ['America/Denver', 'Mountain (US): Denver'],
    ['America/Phoenix', 'Arizona: Phoenix'],
    ['America/Los_Angeles', 'Pacific (US): Los Angeles'],
    ['America/Anchorage', 'Alaska: Anchorage'],
    ['Pacific/Honolulu', 'Hawaii: Honolulu'],
    ['America/Puerto_Rico', 'Atlantic (US): Puerto Rico'],
    ['America/St_Johns', 'Newfoundland: St. John’s'],
    ['America/Halifax', 'Atlantic (CA): Halifax'],
    ['America/Toronto', 'Eastern (CA): Toronto'],
    ['America/Winnipeg', 'Central (CA): Winnipeg'],
    ['America/Regina', 'Saskatchewan: Regina'],
    ['America/Edmonton', 'Mountain (CA): Edmonton'],
    ['America/Vancouver', 'Pacific (CA): Vancouver'],
];

const tzSel = $('#tz');
const tzOtherField = $('#tzOtherField');
const tzOther = $('#tzOther');

function fillZones() {
    const device = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    tzSel.innerHTML = ZONES
        .map(([v, label]) => `<option value="${esc(v)}">${esc(label)}</option>`)
        .join('') + '<option value="other">Other (type an IANA name)</option>';
    if (ZONES.some(([v]) => v === device)) {
        tzSel.value = device;
    } else if (device) {
        // The device zone is real but not on the short list: prefill it.
        tzSel.value = 'other';
        tzOtherField.hidden = false;
        tzOther.value = device;
    }
}

tzSel.addEventListener('change', () => {
    const other = tzSel.value === 'other';
    tzOtherField.hidden = !other;
    if (other) tzOther.focus();
});

/* --- daily-cap health ---------------------------------------------------- */

function showPaused() {
    $('#paused').hidden = false;
    $('#createBtn').disabled = true;
    say('Creation is paused for the day.');
}

async function checkHealth() {
    try {
        const h = await api('parish/start/health');
        if (!h.open) showPaused();
    } catch { /* Health is advisory; the POST is the real gate. */ }
}

/* --- create -------------------------------------------------------------- */

$('#startForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();

    const timezone = tzSel.value === 'other' ? tzOther.value.trim() : tzSel.value;
    if (!timezone) { showError(new Error('Enter a timezone.')); return; }

    const btn = $('#createBtn');
    btn.disabled = true;
    try {
        const data = await api('parish/start', {
            method: 'POST',
            body: {
                name: $('#parishName').value,
                city: $('#city').value,
                state: $('#region').value,
                country: $('#country').value,
                timezone,
                coordinator_name: $('#coordName').value,
                coordinator_email: $('#coordEmail').value,
            },
        });

        /* The only time these two are ever shown. */
        $('#joinCode').textContent = data.join_code;
        $('#passphrase').textContent = data.passphrase;
        $('#doneParish').textContent = `${data.parish.name} is ready.`;
        $('#start').hidden = true;
        $('#done').hidden = false;
        $('#doneTitle').focus();
        say('Parish created. Write down the join code and passphrase now.');
    } catch (err) {
        btn.disabled = false;
        if (err.status === 429) showPaused();
        showError(err);
    }
});

/* --- copy both ----------------------------------------------------------- */

$('#copyBoth').addEventListener('click', async () => {
    const text = `Ostiary\nJoin code: ${$('#joinCode').textContent}\n`
        + `Coordinator passphrase: ${$('#passphrase').textContent}\n`;
    try {
        await navigator.clipboard.writeText(text);
        const badge = $('#copied');
        badge.hidden = false;
        say('Copied to the clipboard. Write them down anyway.');
        setTimeout(() => { badge.hidden = true; }, 3000);
    } catch {
        showError(new Error('Copying failed. Write both down by hand.'));
    }
});

/* --- boot ---------------------------------------------------------------- */

fillZones();
checkHealth();
