/* Page script for admin.html. Extracted from an inline <script> so the
   Content-Security-Policy in _headers can use script-src 'self' with no
   'unsafe-inline'. An inline script would force the policy open for every
   injected string on the page. */

import { api, state, requireSession, fmtDateTime, toLocalInputValue, fromLocalInputValue,
         esc, $, say, showError, clearError, confirmAction } from '/assets/js/app.js';

let slots = [], meetings = [], status = null, google = null;

/* --- team --------------------------------------------------------------- */

async function loadTeam() {
    status = await api('formation/status');
    const rows = status.ushers.map((u) => `
        <tr>
          <td>${esc(u.name)}</td>
          <td>${esc(u.role)}</td>
          <td class="mono">${esc(u.languages || '')}</td>
          <td>${u.done} of ${u.total}
              ${u.done === u.total ? '<span class="pill ok">&#10003; Done</span>' : ''}</td>
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
            <button type="button" class="quiet danger" data-del-slot="${esc(s.id)}">Delete<span class="sr-only"> ${esc(s.label)}</span></button>
          </div>
        </article>`).join('')
        : '<div class="card empty"><p class="muted">No Masses scheduled.</p></div>';
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
              ${m.meet_link ? `<p><a class="meet" href="${esc(m.meet_link)}" rel="noopener"
                  >Google Meet</a></p>` : ''}
            </div>
            <span class="pill plain">${m.counts.yes} coming</span>
          </div>
          <div class="row" style="margin-top:.6rem;">
            <button type="button" data-edit-meeting="${esc(m.id)}">Edit<span class="sr-only"> ${esc(m.title)}</span></button>
            ${m.has_calendar_event ? `<button type="button" data-sync-rsvps="${esc(m.id)}"
                >Sync RSVPs<span class="sr-only"> for ${esc(m.title)}</span></button>` : ''}
            <button type="button" class="quiet danger" data-del-meeting="${esc(m.id)}">Delete<span class="sr-only"> ${esc(m.title)}</span></button>
          </div>
        </article>`).join('')
        : '<div class="card empty"><p class="muted">Nothing scheduled.</p></div>';
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
            send_invites: $('#mInvites').checked || undefined,
        }});
        say('Meeting saved.');
        e.currentTarget.reset();
        $('#mId').value = '';
        $('#mSubmit').textContent = 'Schedule it'; $('#mCancel').hidden = true;
        await loadMeetings();
    } catch (err) {
        showError(err);
        // "Meeting saved, but Google Calendar failed" means the row exists;
        // repaint the list so the screen does not deny what the database holds.
        if (/^Meeting saved/.test(err.message)) await loadMeetings().catch(() => {});
    }
});

$('#meetingList').addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-edit-meeting]');
    const syncBtn = e.target.closest('[data-sync-rsvps]');
    const delBtn = e.target.closest('[data-del-meeting]');
    try {
        clearError();
        if (editBtn) {
            const m = meetings.find((x) => x.id === editBtn.dataset.editMeeting);
            $('#mId').value = m.id; $('#mTitle').value = m.title;
            $('#mWhen').value = toLocalInputValue(m.starts_at);
            $('#mLocation').value = m.location || '';
            $('#mAgenda').value = m.agenda_md || '';
            $('#mMinutes').value = m.minutes_md || '';
            // A meeting that already has a calendar event should keep it in
            // step by default; unticking is the coordinator's call.
            $('#mInvites').checked = !!m.has_calendar_event;
            $('#mSubmit').textContent = 'Save changes'; $('#mCancel').hidden = false;
            $('#mTitle').focus();
        } else if (syncBtn) {
            const r = await api(`google/meetings/${encodeURIComponent(syncBtn.dataset.syncRsvps)}/sync-rsvps`,
                { method: 'POST' });
            say(`RSVPs synced: ${r.updated} updated, ${r.unmatched} not on the roster, `
                + `${r.pending} not yet replied.`);
            await loadMeetings();
        } else if (delBtn) {
            const m = meetings.find((x) => x.id === delBtn.dataset.delMeeting);
            const yes = await confirmAction({
                title: 'Delete this meeting?',
                message: `${m.title} on ${fmtDateTime(m.starts_at)}. RSVPs and minutes go with it.`
                    + `${m.has_calendar_event
                        ? ' The calendar event is cancelled and attendees are told.' : ''}`
                    + ' This cannot be undone.',
                confirmLabel: 'Delete it',
                danger: true,
            });
            if (!yes) return;
            await api(`admin/meeting?id=${encodeURIComponent(m.id)}`, { method: 'DELETE' });
            say('Meeting deleted.');
            await loadMeetings();
        }
    } catch (err) { showError(err); }
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

/* --- google ------------------------------------------------------------- */

const GOOGLE_ADMIN_MESSAGES = {
    connected: null, // handled as a success announcement, not an error
    denied: 'Google connection was cancelled. Nothing changed.',
    norefresh: 'Google did not return a refresh token, so nothing was stored. '
        + 'Try connecting again.',
    error: 'Connecting Google did not complete. Try again.',
};

async function loadGoogle() {
    $('#gLoading').hidden = false;
    $('#gOff').hidden = true; $('#gConnect').hidden = true; $('#gOn').hidden = true;
    try {
        google = await api('google/status');
    } catch (err) {
        google = null;
        $('#gLoading').hidden = true;
        if (err.status === 503) { $('#gOff').hidden = false; return; }
        showError(err);
        return;
    }
    $('#gLoading').hidden = true;
    if (google.connected) {
        $('#gOn').hidden = false;
        $('#gEmail').textContent = google.connected_email;
        $('#gGroupEmail').value = google.group_email || '';
        $('#gGroupSync').disabled = !google.groups_scope;
        $('#gReport').textContent = google.groups_scope ? ''
            : 'This connection was made without the group scope, so group sync is off. '
            + 'Calendar invites and Meet still work.';
    } else {
        $('#gConnect').hidden = false;
    }
    // The invite toggle on the meeting form only makes sense with a connection.
    $('#mInvitesField').hidden = !google.connected;
}

function reportGoogleResult() {
    const code = new URLSearchParams(location.search).get('google');
    if (!code) return;
    history.replaceState(null, '', location.pathname);
    if (code === 'connected') say('Google connected.');
    else if (GOOGLE_ADMIN_MESSAGES[code]) showError(new Error(GOOGLE_ADMIN_MESSAGES[code]));
}

$('#gGroups').addEventListener('change', () => {
    $('#gConnectLink').href = `/api/google/connect${$('#gGroups').checked ? '?groups=1' : ''}`;
});

$('#gGroupSave').addEventListener('click', async () => {
    try {
        clearError();
        await api('google/group', { method: 'POST', body: { group_email: $('#gGroupEmail').value } });
        say('Group email saved.');
    } catch (err) { showError(err); }
});

$('#gGroupSync').addEventListener('click', async () => {
    try {
        clearError();
        $('#gReport').textContent = 'Syncing.';
        const r = await api('google/group/sync', { method: 'POST' });
        const parts = [`Added ${r.added}, removed ${r.removed}.`];
        if (r.kept_owner) parts.push('Kept the connected account in the group.');
        if (r.skipped_no_email) parts.push(`Skipped ${r.skipped_no_email} without an email.`);
        for (const f of r.failures || []) parts.push(`Could not ${f.op} ${f.email}: ${f.error}`);
        $('#gReport').textContent = parts.join(' ');
        say('Group sync finished.');
    } catch (err) {
        $('#gReport').textContent = '';
        showError(err);
    }
});

$('#gDisconnect').addEventListener('click', async () => {
    const yes = await confirmAction({
        title: 'Disconnect Google?',
        message: 'Calendar invites and group sync stop until someone connects again. '
            + 'Meetings and RSVPs already in Ostiary are untouched.',
        confirmLabel: 'Disconnect',
        danger: true,
    });
    if (!yes) return;
    try {
        clearError();
        await api('google/disconnect', { method: 'POST' });
        say('Google disconnected.');
        await loadGoogle();
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
        reportGoogleResult();
        try {
            await Promise.all([loadTeam(), loadSlots(), loadMeetings(), loadGoogle()]);
        } catch (err) { showError(err); }
    }
}
