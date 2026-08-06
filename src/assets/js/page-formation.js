/* Page script for formation.html. Extracted from an inline <script> so the
   Content-Security-Policy in _headers can use script-src 'self' with no
   'unsafe-inline'. An inline script would force the policy open for every
   injected string on the page. */

import { api, requireSession, fmtDate, esc, $, say, showError, clearError }
    from '/assets/js/app.js';

let modules = [];
let policyNotes = null;

/* --- list --------------------------------------------------------------- */

function renderList() {
    const done = modules.filter((m) => m.progress).length;
    const pct = Math.round((done / modules.length) * 100);
    $('#progressText').textContent = `${done} of ${modules.length} modules complete`;
    $('#progressPill').textContent = `${pct}%`;
    $('#progressFill').style.width = `${pct}%`;
    $('#progressBar').setAttribute('aria-label', `${done} of ${modules.length} modules complete`);

    $('#modules').innerHTML = modules.map((m) => {
        const p = m.progress;
        return `<article class="slot ${p ? 'mine' : ''}">
          <div class="row between">
            <div>
              <h3>${m.ord}. ${esc(m.title)}</h3>
              <p class="when">${esc(m.summary)}</p>
            </div>
            <div class="row">
              ${m.policy_gap ? '<span class="pill warn">! Needs parish policy</span>' : ''}
              ${p ? `<span class="pill ok">&#10003; Done ${esc(fmtDate(p.completed_at))}</span>`
                  : `<span class="pill plain">${m.minutes} min</span>`}
            </div>
          </div>
          <div class="row" style="margin-top:.6rem;">
            <button type="button" class="${p ? '' : 'primary'}" data-open="${esc(m.slug)}">
              ${p ? 'Review' : 'Start'}<span class="sr-only"> module ${m.ord}, ${esc(m.title)}</span>
            </button>
          </div>
        </article>`;
    }).join('');
}

/* --- single module ------------------------------------------------------ */

/* Reference rows under a section. A linked citation makes the whole row the
   link; an unlinked one renders the same row with no link and no fake
   affordance, because an honest unlinked citation beats a dead link. */
function renderCites(cites) {
    if (!cites || !cites.length) return '';
    return `<ul class="cites">${cites.map((c) => {
        const inner = `<span class="cite-src">${esc(c.source)}${c.ref ? `, ${esc(c.ref)}` : ''}</span>
            <span class="cite-gloss">${esc(c.gloss)}</span>`;
        return c.url
            ? `<li><a class="cite" href="${esc(c.url)}" target="_blank" rel="noopener">${inner}<span class="sr-only"> (opens in a new tab)</span></a></li>`
            : `<li><div class="cite">${inner}</div></li>`;
    }).join('')}</ul>`;
}

function openModule(slug) {
    const m = modules.find((x) => x.slug === slug);
    if (!m) return;

    $('#listView').hidden = true;
    $('#moduleView').hidden = false;
    $('#results').hidden = true;
    $('#checkForm').hidden = false;

    $('#modTitle').textContent = `${m.ord}. ${m.title}`;
    $('#modMeta').textContent = `About ${m.minutes} minutes. ${m.summary}`;

    const gap = $('#policyBanner');
    gap.hidden = !m.policy_gap;
    $('#policyNotes').innerHTML = m.policy_gap && policyNotes
        ? `<p><strong>Your parish added:</strong></p><p>${esc(policyNotes).replace(/\n/g, '<br>')}</p>`
        : (m.policy_gap ? '<p><em>Your coordinator has not filled this in yet.</em></p>' : '');

    $('#modBody').innerHTML = m.sections.map((s) => `
        <h2>${esc(s.heading)}</h2>
        ${s.body.map((p) => `<p>${esc(p)}</p>`).join('')}
        ${renderCites(s.citations)}`).join('');

    $('#questions').innerHTML = m.check.map((c, i) => `
        <fieldset class="q">
          <legend>${esc(c.q)}</legend>
          ${c.options.map((o, j) => `
            <label class="opt">
              <input type="radio" name="q${i}" value="${j}" required>
              <span>${esc(o)}</span>
            </label>`).join('')}
        </fieldset>`).join('');

    $('#checkForm').dataset.slug = slug;
    document.getElementById('main').scrollIntoView({ block: 'start' });
    $('#modTitle').setAttribute('tabindex', '-1');
    $('#modTitle').focus();
}

function closeModule() {
    $('#moduleView').hidden = true;
    $('#listView').hidden = false;
    renderList();
    $('#main').scrollIntoView({ block: 'start' });
}

$('#modules').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-open]');
    if (btn) openModule(btn.dataset.open);
});
$('#backBtn').addEventListener('click', closeModule);

$('#checkForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    const form = e.currentTarget;
    const slug = form.dataset.slug;
    const m = modules.find((x) => x.slug === slug);

    const answers = m.check.map((_, i) => {
        const picked = form.querySelector(`input[name="q${i}"]:checked`);
        return picked ? Number(picked.value) : -1;
    });

    try {
        const res = await api('formation/complete', {
            method: 'POST', body: { module_slug: slug, answers },
        });
        // Update in place so going back to the list shows the new state without
        // a refetch.
        m.progress = { completed_at: Math.floor(Date.now() / 1000),
                       score: res.score, score_max: res.score_max };

        form.hidden = true;
        const box = $('#results');
        box.hidden = false;
        box.innerHTML = `<div class="card">
            <h2>Module complete</h2>
            <p>You got <strong>${res.score} of ${res.score_max}</strong>.</p>
            ${res.feedback.map((f) => `
              <div class="slot ${f.correct ? 'mine' : 'short'}">
                <p style="margin:0 0 .3rem;"><strong>${esc(f.q)}</strong></p>
                <p class="small" style="margin:0 0 .3rem;">
                  <span class="pill ${f.correct ? 'ok' : 'warn'}">
                    ${f.correct ? '&#10003; Correct' : '! Worth another look'}</span>
                </p>
                <p class="small" style="margin:0;">${esc(f.why)}</p>
              </div>`).join('')}
            <button type="button" class="primary" id="doneBtn">Back to all modules</button>
          </div>`;
        $('#doneBtn').addEventListener('click', closeModule);
        say(`Module complete. ${res.score} of ${res.score_max} correct.`);
        box.querySelector('h2').setAttribute('tabindex', '-1');
        box.querySelector('h2').focus();
    } catch (err) { showError(err); }
});

/* --- boot --------------------------------------------------------------- */

if (await requireSession()) {
    try {
        const data = await api('formation');
        modules = data.modules;
        policyNotes = data.policy_notes;
        renderList();
        // Deep link: /formation.html#collection opens that module directly.
        const slug = location.hash.replace('#', '');
        if (slug && modules.some((m) => m.slug === slug)) openModule(slug);
    } catch (err) { showError(err); }
}
