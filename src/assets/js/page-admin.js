/* Page script for admin.html. Extracted from an inline <script> so the
   Content-Security-Policy in _headers can use script-src 'self' with no
   'unsafe-inline'. An inline script would force the policy open for every
   injected string on the page. */

import { api, state, requireSession, fmtDateTime, toLocalInputValue, fromLocalInputValue,
         esc, $, say, showError, clearError, confirmAction } from '/assets/js/app.js';

let slots = [], meetings = [], status = null;

/* --- team --------------------------------------------------------------- */

async function loadTeam() {
    status = await api('formation/status');
    const rows = status.ushers.map((u) => `
        <tr>
          <td>${esc(u.name)}</td>
          <td>${esc(u.role)}</td>
          <td class="mono">${esc(state.roster?.[u.id]?.languages || '')}</td>
          <td>${u.done} of ${u.total}
              ${u.done === u.total ? '<span class="pill ok">&#10003;</span>' : ''}</td>
          <td><button type="button" class="quiet" data-edit-usher="${esc(u.id)}"
                >Edit<span class="sr-only"> ${esc(u.name)}</span></button></td>
        </tr>`).join('');
    $('#usherTable tbody').innerHTML = rows ||
        '<tr><td colspan="5" class="muted">Nobody on the team yet.</td></tr>';
}

$('#usherForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    try {
        await api('admin/usher', { method: 'POST', body: {
            id: $('#uId').value || undefined,
            name: $('#uName').value, email: $('#uEmail').value,
            phone: $('#uPhone').value, role: $('#uRole').value,
            languages: $('#uLangs').value,
        }});
        say('Saved.');
        e.currentTarget.reset();
        $('#uId').value = '';
        $('#uSubmit').textContent = 'Add to the team';
        $('#uCancel').hidden = true;
        await loadTeam();
    } catch (err) { showError(err); }
});

$('#usherTable').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-edit-usher]');
    if (!btn) return;
    const u = status.ushers.find((x) => x.id === btn.dataset.editUsher);
    if (!u) return;
    $('#uId').value = u.id;
    $('#uName').value = u.name;
    $('#uRole').value = u.role;
    $('#uSubmit').textContent = 'Save changes';
    $('#uCancel').hidden = false;
    $('#uName').focus();
});
$('#uCancel').addEventListener('click', () => {
    $('#usherForm').reset(); $('#uId').value = '';
    $('#uSubmit').textContent = 'Add to the team'; $('#uCancel').hidden = true;
});

/* --- masses ------------------------------------------------------------- */

async function loadSlots() {
    const data = await api('roster?days=60');
    slots = data.slots;
    $('#slotList').innerHTML = slots.length ? slots.map((s) => `
        <article class="slot ${s.unconfirmed_time ? 'short' : ''}">
          <div class="row between">
            <div>
              <h3>${esc(s.label)}</h3>
              <p class="when">${esc(fmtDateTime(s.starts_at))} &middot;
                 ${s.filled} of ${s.ushers_needed} signed up</p>
            </div>
            <div class="row">
              ${s.unconfirmed_time ? '<span class="pill warn">! Time not confirmed</span>' : ''}
            </div>
          </div>
          <div class="row" style="margin-top:.6rem;">
            ${s.unconfirmed_time ? `<button type="button" class="primary" data-confirm="${esc(s.id)}"
                >Confirm this time<span class="sr-only"> for ${esc(s.label)}</span></button>` : ''}
            <button type="button" data-edit-slot="${esc(s.id)}">Edit<span class="sr-only"> ${esc(s.label)}</span></button>
            <button type="button" data-del-slot="${esc(s.id)}">Delete<span class="sr-only"> ${esc(s.label)}</span></button>
          </div>
        </article>`).join('')
        : '<div class="card"><p class="muted">No Masses scheduled.</p></div>';
}

$('#slotForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    const startsAt = fromLocalInputValue($('#sWhen').value);
    if (!startsAt) { showError(new Error('Enter a valid date and time.')); return; }
    try {
        await api('admin/slot', { method: 'POST', body: {
            id: $('#sId').value || undefined,
            label: $('#sLabel').value, starts_at: startsAt,
            language: $('#sLang').value,
            ushers_needed: Number($('#sNeeded').value),
            // A time a coordinator typed is confirmed by definition.
            confirm_time: true,
        }});
        say('Mass saved.');
        e.currentTarget.reset();
        $('#sId').value = ''; $('#sLang').value = 'en'; $('#sNeeded').value = '4';
        $('#sSubmit').textContent = 'Add this Mass'; $('#sCancel').hidden = true;
        await loadSlots();
    } catch (err) { showError(err); }
});

$('#slotList').addEventListener('click', async (e) => {
    const confirmBtn = e.target.closest('[data-confirm]');
    const editBtn = e.target.closest('[data-edit-slot]');
    const delBtn = e.target.closest('[data-del-slot]');
    try {
        clearError();
        if (confirmBtn) {
            await api('admin/slot', { method: 'POST',
                body: { id: confirmBtn.dataset.confirm, confirm_time: true } });
            say('Time confirmed.');
            await loadSlots();
        } else if (editBtn) {
            const s = slots.find((x) => x.id === editBtn.dataset.editSlot);
            $('#sId').value = s.id; $('#sLabel').value = s.label;
            $('#sWhen').value = toLocalInputValue(s.starts_at);
            $('#sLang').value = s.language; $('#sNeeded').value = s.ushers_needed;
            $('#sSubmit').textContent = 'Save changes'; $('#sCancel').hidden = false;
            $('#sLabel').focus();
        } else if (delBtn) {
            const s = slots.find((x) => x.id === delBtn.dataset.delSlot);
            const yes = await confirmAction({
                title: 'Delete this Mass?',
                message: `${s.label} on ${fmtDateTime(s.starts_at)}. `
                    + `${s.filled} sign-up${s.filled === 1 ? '' : 's'} will be deleted with it. `
                    + 'This cannot be undone.',
                confirmLabel: 'Delete it',
                danger: true,
            });
            if (!yes) return;
            await api(`admin/slot?id=${encodeURIComponent(s.id)}`, { method: 'DELETE' });
            say('Mass deleted.');
            await loadSlots();
        }
    } catch (err) { showError(err); }
});

$('#sCancel').addEventListener('click', () => {
    $('#slotForm').reset(); $('#sId').value = '';
    $('#sSubmit').textContent = 'Add this Mass'; $('#sCancel').hidden = true;
});

/* --- meetings ----------------------------------------------------------- */

async function loadMeetings() {
    const data = await api('meetings');
    meetings = data.meetings;
    $('#meetingList').innerHTML = meetings.length ? meetings.map((m) => `
        <article class="slot">
          <div class="row between">
            <div>
              <h3>${esc(m.title)}</h3>
              <p class="when">${esc(fmtDateTime(m.starts_at))}${m.location ? ` at ${esc(m.location)}` : ''}</p>
            </div>
            <span class="pill plain">${m.counts.yes} coming</span>
          </div>
          <div class="row" style="margin-top:.6rem;">
            <button type="button" data-edit-meeting="${esc(m.id)}">Edit<span class="sr-only"> ${esc(m.title)}</span></button>
          </div>
        </article>`).join('')
        : '<div class="card"><p class="muted">Nothing scheduled.</p></div>';
}

$('#meetingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    const startsAt = fromLocalInputValue($('#mWhen').value);
    if (!startsAt) { showError(new Error('Enter a valid date and time.')); return; }
    try {
        await api('admin/meeting', { method: 'POST', body: {
            id: $('#mId').value || undefined,
            title: $('#mTitle').value, starts_at: startsAt,
            location: $('#mLocation').value,
            agenda_md: $('#mAgenda').value, minutes_md: $('#mMinutes').value,
        }});
        say('Meeting saved.');
        e.currentTarget.reset();
        $('#mId').value = '';
        $('#mSubmit').textContent = 'Schedule it'; $('#mCancel').hidden = true;
        await loadMeetings();
    } catch (err) { showError(err); }
});

$('#meetingList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-edit-meeting]');
    if (!btn) return;
    const m = meetings.find((x) => x.id === btn.dataset.editMeeting);
    $('#mId').value = m.id; $('#mTitle').value = m.title;
    $('#mWhen').value = toLocalInputValue(m.starts_at);
    $('#mLocation').value = m.location || '';
    $('#mAgenda').value = m.agenda_md || '';
    $('#mMinutes').value = m.minutes_md || '';
    $('#mSubmit').textContent = 'Save changes'; $('#mCancel').hidden = false;
    $('#mTitle').focus();
});
$('#mCancel').addEventListener('click', () => {
    $('#meetingForm').reset(); $('#mId').value = '';
    $('#mSubmit').textContent = 'Schedule it'; $('#mCancel').hidden = true;
});

/* --- parish ------------------------------------------------------------- */

$('#parishForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    const body = { policy_notes: $('#pNotes').value };
    if ($('#pPass').value) body.passphrase = $('#pPass').value;
    try {
        await api('admin/parish', { method: 'POST', body });
        $('#pPass').value = '';
        say('Saved.');
    } catch (err) { showError(err); }
});

/* --- boot --------------------------------------------------------------- */

const me = await requireSession();
if (me) {
    if (!me.admin) {
        $('#denied').hidden = false;
    } else {
        $('#tools').hidden = false;
        $('#pNotes').value = me.parish.policy_notes || '';
        try {
            await Promise.all([loadTeam(), loadSlots(), loadMeetings()]);
        } catch (err) { showError(err); }
    }
}
