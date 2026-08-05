/* Ostiary shared client. No framework, no build step. */

export const state = { me: null };

/* --- api ---------------------------------------------------------------- */

export async function api(path, options = {}) {
    const init = { credentials: 'same-origin', ...options };
    if (init.body && typeof init.body !== 'string') {
        init.headers = { ...(init.headers || {}), 'Content-Type': 'application/json' };
        init.body = JSON.stringify(init.body);
    }
    const res = await fetch(`/api/${path}`, init);
    let data;
    try {
        data = await res.json();
    } catch {
        // A non-JSON body here means the Function crashed or a proxy replaced
        // the response. Surface the status rather than a parse error.
        throw new Error(`Server returned ${res.status}.`);
    }
    if (!res.ok || data.ok === false) {
        const err = new Error(data.error || `Request failed (${res.status}).`);
        err.status = res.status;
        throw err;
    }
    return data;
}

/* --- session guard ------------------------------------------------------ */

/** Load the signed-in user, or bounce to the sign-in page.
 *  Every page except index.html calls this first. */
export async function requireSession() {
    try {
        state.me = await api('me');
        paintIdentity();
        return state.me;
    } catch (err) {
        if (err.status === 401) {
            location.replace(`/?next=${encodeURIComponent(location.pathname)}`);
            return null;
        }
        throw err;
    }
}

function paintIdentity() {
    const el = document.getElementById('identity');
    if (!el || !state.me) return;
    const who = state.me.usher ? state.me.usher.name : 'Coordinator';
    const role = state.me.admin ? ' (coordinator)' : '';
    el.textContent = `${who}${role} at ${state.me.parish.name}`;
}

export async function signOut() {
    await api('session', { method: 'DELETE' });
    location.href = '/';
}

/* --- dates -------------------------------------------------------------- */

export function parishZone() {
    return state.me?.parish?.timezone || 'America/Los_Angeles';
}

/** Format a unix-second instant in the parish's timezone, never the device's.
 *  An usher travelling should still see the Mass time the parish uses. */
export function fmtDateTime(unixSeconds, opts = {}) {
    return new Intl.DateTimeFormat('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
        timeZone: parishZone(), ...opts,
    }).format(new Date(unixSeconds * 1000));
}

export function fmtDate(unixSeconds) {
    return fmtDateTime(unixSeconds, { hour: undefined, minute: undefined });
}

/** "in 3 days" / "today". Uses whole days in the parish zone. */
export function relativeDay(unixSeconds) {
    const dayKey = (d) => new Intl.DateTimeFormat('en-CA', {
        timeZone: parishZone(), year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);
    const then = new Date(unixSeconds * 1000);
    const a = new Date(dayKey(new Date()) + 'T00:00:00Z');
    const b = new Date(dayKey(then) + 'T00:00:00Z');
    const days = Math.round((b - a) / 86400000);
    if (days === 0) return 'today';
    if (days === 1) return 'tomorrow';
    if (days > 1 && days < 14) return `in ${days} days`;
    return '';
}

/** For <input type="datetime-local">: unix seconds to a parish-zone wall clock. */
export function toLocalInputValue(unixSeconds) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: parishZone(), hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(unixSeconds * 1000));
    const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${String(p.hour % 24).padStart(2, '0')}:${p.minute}`;
}

/** Inverse: a parish-zone wall clock back to unix seconds, DST-correct.
 *  Two passes settle the offset, the same trick the seed script uses. */
export function fromLocalInputValue(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
    if (!m) return null;
    const [, y, mo, d, hh, mm] = m.map(Number);
    const zone = parishZone();
    const offsetAt = (ts) => {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: zone, hour12: false,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
        }).formatToParts(new Date(ts));
        const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
        const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
        return asUTC - ts;
    };
    let ts = Date.UTC(y, mo - 1, d, hh, mm, 0);
    for (let i = 0; i < 2; i++) ts = Date.UTC(y, mo - 1, d, hh, mm, 0) - offsetAt(ts);
    return Math.floor(ts / 1000);
}

/* --- dom ---------------------------------------------------------------- */

export function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

/** Announce to the page's live region. Assertive for errors so a screen
 *  reader interrupts rather than queueing behind whatever is being read. */
export function say(message, kind = 'status') {
    const region = document.getElementById('live');
    if (!region) return;
    region.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
    region.textContent = '';
    // Same-text updates are not re-announced unless the node actually changes.
    requestAnimationFrame(() => { region.textContent = message; });
}

export function showError(err) {
    console.error(err);
    say(err.message || 'Something went wrong.', 'error');
    const box = document.getElementById('error');
    if (box) {
        box.textContent = err.message || 'Something went wrong.';
        box.hidden = false;
    }
}

export function clearError() {
    const box = document.getElementById('error');
    if (box) { box.hidden = true; box.textContent = ''; }
}

/** Mark the current page in the nav for both sighted and assistive users. */
/* --- dialogs -------------------------------------------------------------
   Replaces window.prompt and window.confirm. Those are unstyleable, ignore the
   page's dark mode, cannot be given a description, and on some platforms are
   announced badly or suppressed entirely. A native <dialog> opened with
   showModal() gives real focus trapping, Escape to dismiss, and inert
   background content for free, which is more than a hand-rolled modal usually
   manages.                                                                  */

function buildDialog(inner) {
    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    dlg.innerHTML = inner;
    document.body.appendChild(dlg);
    return dlg;
}

/** Ask a yes/no question. Resolves true when confirmed. */
export function confirmAction({ title, message, confirmLabel = 'Confirm', danger = false }) {
    return new Promise((resolve) => {
        const dlg = buildDialog(`
          <form method="dialog">
            <h2>${esc(title)}</h2>
            <p>${esc(message)}</p>
            <div class="row" style="justify-content:flex-end;">
              <button value="cancel" class="quiet">Cancel</button>
              <button value="ok" class="${danger ? 'danger' : 'primary'}">${esc(confirmLabel)}</button>
            </div>
          </form>`);
        dlg.addEventListener('close', () => {
            const ok = dlg.returnValue === 'ok';
            dlg.remove();
            resolve(ok);
        }, { once: true });
        dlg.showModal();
        // Focus the safe choice, not the destructive one.
        dlg.querySelector('button[value="cancel"]').focus();
    });
}

/** Ask for a line of text. Resolves the string, or null if cancelled. */
export function askText({ title, label, hint = '', confirmLabel = 'Save', optional = true }) {
    return new Promise((resolve) => {
        const id = `ask-${Math.random().toString(36).slice(2, 8)}`;
        const dlg = buildDialog(`
          <form method="dialog">
            <h2>${esc(title)}</h2>
            <div class="field">
              <label for="${id}">${esc(label)}</label>
              <input id="${id}" type="text" ${optional ? '' : 'required'}
                     ${hint ? `aria-describedby="${id}-hint"` : ''}>
              ${hint ? `<p class="hint" id="${id}-hint">${esc(hint)}</p>` : ''}
            </div>
            <div class="row" style="justify-content:flex-end;">
              <button value="cancel" class="quiet">Cancel</button>
              <button value="ok" class="primary">${esc(confirmLabel)}</button>
            </div>
          </form>`);
        const input = dlg.querySelector('input');
        dlg.addEventListener('close', () => {
            const value = dlg.returnValue === 'ok' ? input.value.trim() : null;
            dlg.remove();
            resolve(value);
        }, { once: true });
        dlg.showModal();
        input.focus();
    });
}

export function markNav() {
    const here = location.pathname.replace(/index\.html$/, '') || '/';
    for (const a of $$('nav.main a')) {
        const href = a.getAttribute('href');
        if (href === here || (href !== '/' && here.startsWith(href))) {
            a.setAttribute('aria-current', 'page');
        }
    }
}

document.addEventListener('DOMContentLoaded', markNav);
