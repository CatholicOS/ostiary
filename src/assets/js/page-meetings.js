/* Page script for meetings.html. Extracted from an inline <script> so the
   Content-Security-Policy in _headers can use script-src 'self' with no
   'unsafe-inline'. An inline script would force the policy open for every
   injected string on the page. */

import { api, requireSession, fmtDateTime, relativeDay, esc, $, $$, say, showError, clearError }
    from '/assets/js/app.js';

let showPast = false;

/** Minimal, deliberate markdown: paragraphs and single-level lists only.
 *  Everything is escaped first, so no agenda text can inject markup. */
function lightMarkdown(text) {
    if (!text) return '';
    const lines = esc(text).split('\n');
    let html = '';
    let inList = false;
    for (const raw of lines) {
        const line = raw.trim();
        const item = /^(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
        if (item) {
            if (!inList) { html += '<ul>'; inList = true; }
            html += `<li>${item[1]}</li>`;
        } else {
            if (inList) { html += '</ul>'; inList = false; }
            if (line) html += `<p>${line}</p>`;
        }
    }
    if (inList) html += '</ul>';
    return html;
}

function rsvpButtons(m) {
    const opts = [['yes', 'I will be there'], ['maybe', 'Maybe'], ['no', 'I cannot']];
    return opts.map(([value, label]) => `
        <button type="button" data-rsvp="${esc(value)}" data-meeting="${esc(m.id)}"
                class="${m.my_rsvp === value ? 'primary' : ''}"
                aria-pressed="${m.my_rsvp === value}">
          ${label}<span class="sr-only"> for ${esc(m.title)}</span>
        </button>`).join('');
}

function meetingMarkup(m) {
    const rel = relativeDay(m.starts_at);
    const attended = m.rsvps.filter((r) => r.attended);
    return `<article class="card">
      <div class="row between">
        <div>
          <h2 style="margin-top:0;">${esc(m.title)}</h2>
          <p class="when muted">${esc(fmtDateTime(m.starts_at))}${rel ? ` (${rel})` : ''}
             ${m.location ? ` at ${esc(m.location)}` : ''}</p>
        </div>
        <span class="pill plain">${m.counts.yes} coming</span>
      </div>

      ${m.agenda_md ? `<h3>Agenda</h3>${lightMarkdown(m.agenda_md)}` : ''}
      ${m.minutes_md ? `<h3>Minutes</h3>${lightMarkdown(m.minutes_md)}`
                     : (showPast ? '<p class="muted">No minutes recorded.</p>' : '')}

      ${showPast
        ? `<p class="small muted">${attended.length
              ? `Attended: ${attended.map((r) => esc(r.name)).join(', ')}`
              : 'Attendance was not recorded.'}</p>`
        : `<div class="row" style="margin-top:.8rem;" role="group"
                aria-label="Your reply to ${esc(m.title)}">${rsvpButtons(m)}</div>
           <p class="small muted" style="margin-top:.5rem;">
             ${m.counts.yes} coming, ${m.counts.no} cannot, ${m.counts.maybe} unsure.</p>`}
    </article>`;
}

async function load() {
    try {
        clearError();
        const { meetings } = await api(`meetings${showPast ? '?past=1' : ''}`);
        const box = $('#meetings');
        box.innerHTML = meetings.length
            ? meetings.map(meetingMarkup).join('')
            : `<div class="card"><p class="muted">${showPast
                ? 'No past meetings on record.' : 'Nothing scheduled yet.'}</p></div>`;
    } catch (err) { showError(err); }
}

$('#meetings').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-rsvp]');
    if (!btn) return;
    try {
        clearError();
        await api('meetings/rsvp', {
            method: 'POST',
            body: { meeting_id: btn.dataset.meeting, status: btn.dataset.rsvp },
        });
        say('Reply saved.');
        await load();
    } catch (err) { showError(err); }
});

$('#tabUpcoming').addEventListener('click', () => switchTab(false, 'tabUpcoming'));
$('#tabPast').addEventListener('click', () => switchTab(true, 'tabPast'));

function switchTab(past, id) {
    showPast = past;
    for (const b of $$('[aria-pressed]')) {
        if (b.id.startsWith('tab')) b.setAttribute('aria-pressed', String(b.id === id));
    }
    load();
    say(past ? 'Showing past meetings.' : 'Showing upcoming meetings.');
}

if (await requireSession()) await load();
