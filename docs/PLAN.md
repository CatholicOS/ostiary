# Ostiary

**Usher formation and meeting organization for Catholic parishes.**

The *ostiarius* (porter, doorkeeper) was one of the minor orders of the Latin
Church until 1972. He held the keys, opened the doors, and decided who came in.
That is the usher's job today, minus the tonsure. The app is named for him.

Working domain: `ostiary.org` (not yet purchased). Ships first to
`ostiary.pages.dev`.

---

## What it does

Two jobs that parishes currently do in a group text and a paper sign-up sheet.

**Formation.** Eight modules a new usher works through, with progress tracked
per person so the coordinator can see who has actually been trained before
handing them a collection basket.

**Organization.** Mass-by-Mass rosters that ushers sign up for themselves,
sub requests when someone cannot make their slot, and team meetings with
agendas, minutes, and RSVPs.

Not in v1: push notifications, SMS, payments, multi-diocese onboarding,
native apps.

---

## Stack and why

Cloudflare Pages + D1 + plain HTML + TypeScript Pages Functions. This is the
same shape as `lachurches-org`, deliberately.

The portfolio already carries three web stacks: CSV is Vite/React/Express on
Vercel, SmartPews is Bun/React-SSR/Supabase, lachurches is Pages/D1/static
HTML. Ostiary is a small app with maybe fifteen screens of state. Adding a
fourth stack buys nothing; picking the lightest existing one means no build
framework, no hydration, and a coordinator can open `src/roster.html` and read
what it does.

Everything is server-rendered-free: static HTML fetches JSON from
`/api/*`. Files stay under the 500-line house limit by splitting route handlers
into `functions/_lib/routes-*.ts` behind a single catch-all router.

### Database

Ostiary gets its **own** D1 (`ostiary-db`), separate from `lachurches-db`.

This is a privacy boundary, not an accident. `lachurches-db` is a public church
directory. An usher roster holds parishioner names, emails, and phone numbers
plus who was absent from which meeting. That is parish-internal operational
data and it does not belong in the same database as a public map. The parish
row is denormalized (slug, name, city, timezone) so Ostiary never needs a join
across the boundary.

---

## Schema

| Table | Holds |
|---|---|
| `parishes` | Local parish record: slug, name, city, timezone, join code, admin passphrase hash |
| `ushers` | Name, contact, role (`usher` / `captain` / `coordinator`), languages, active flag |
| `mass_slots` | One serving slot: parish, UTC start, label ("Sunday 10:00 Sung Mass"), language, ushers needed |
| `assignments` | Usher to slot, with status `assigned` / `confirmed` / `sub_requested` / `dropped` |
| `formation_progress` | Usher to module slug, completed timestamp, self-check score |
| `meetings` | Parish meeting: UTC start, title, location, agenda, minutes |
| `meeting_rsvps` | Usher to meeting: `yes` / `no` / `maybe`, plus attended flag |
| `parish_starts` | Self-onboarding cap ledger: HMAC'd caller IP (never the raw IP), truncated user-agent, timestamp |

Curriculum content is **not** in the database. It lives in
`functions/_lib/curriculum.ts` as the single source of truth, versioned in git,
served to the client by `GET /api/formation`. Content belongs where it can be
diffed and reviewed by a pastor, not in a row somebody edits at 11pm.

---

## Auth, stated honestly

Two levels, both cookie-based with an HMAC-signed payload (Web Crypto, no JWT
dependency):

1. **Usher.** Enters the parish join code and picks their name off the roster
   the coordinator already created. No password.
2. **Coordinator.** Parish join code plus an admin passphrase, checked against
   a PBKDF2 hash.

This is shoulder-surf resistant, not attacker resistant. Anyone holding a
parish join code can see that parish's roster and sign themselves up for a
Mass. That is an acceptable trade for a volunteer usher list; it would not be
acceptable for anything sacramental, financial, or safe-environment related,
and the app must never be extended to hold those without a real identity
provider first.

**Google sign-in (optional, see docs/GOOGLE.md) is now that stronger identity,
with limits worth stating.** When a parish configures it, an usher whose email
is on the roster can sign in through Google OIDC instead of picking their name,
which upgrades "I know the join code" to "I control that mailbox" for that
person. What it does not change: the join-code flow still exists as the
fallback, so the floor of the threat model is unchanged until that flow is
retired per parish (not built); nobody is auto-created from Google sign-in;
and coordinator authority is still the passphrase, never the Google account.
So the rule above stands. Sacramental, financial, and safe-environment records
stay out until the join-code fallback can actually be turned off.

Consequence for content: the formation module on the collection describes
*procedure*, never account numbers, safe locations, or alarm codes.

---

## Self-onboarding, and its honesty

Any parish can create its own roster at `/start` (`POST /api/parish/start`).
No operator, no approval queue. What keeps that honest:

- **The passphrase is shown once.** The server generates a coordinator
  passphrase (20 random characters from an unambiguous alphabet, 100 bits),
  stores only its PBKDF2 hash, and returns the plaintext in exactly one
  response. It cannot be recovered, and the page says so before anything else.
  The coordinator can replace it from the admin screen.
- **Caps, not captchas.** Two creations per caller per 24 hours, twenty
  globally. Over the cap the answer is a 429 that says "ask again tomorrow"
  in words, and `GET /api/parish/start/health` lets the page say it before
  the form is filled in. No Turnstile, no third-party service: the caps make
  bulk abuse pointless and a captcha would only tax the legitimate.
- **`ip_hash`, never the IP.** The cap ledger (`parish_starts`) stores
  HMAC-SHA256 of the caller's IP under `SESSION_SECRET`. That answers "same
  caller today?" and nothing else; raw addresses are never written anywhere.
  The truncated user-agent (`origin_note`) is kept for abuse review.
- **The `reviewed` flag.** Self-created parishes carry `reviewed = 0`;
  operator-seeded ones carry 1. Nothing gates on it yet. It exists so a
  platform owner can later list what arrived unreviewed, rather than
  discovering it by accident.

A new parish arrives with zero Mass slots and one usher (the coordinator).
The empty roster is the design: guessed Mass times were already ruled out for
the seed parish, and the rule holds harder for a parish nobody here has seen.

---

## Formation curriculum

Eight modules, roughly 12 minutes each:

1. **Who the Doorkeeper Is** — the minor order, hospitality as ministry
   (Rom 12:13, Heb 13:2, Mt 25:35), the usher as the parish's first face.
2. **Before Mass** — the walk-through, worship aids, doors and lights,
   reserved seating, the greeting itself.
3. **Seating the Assembly** — latecomers, when not to seat anyone, families
   with small children, visitors, and spotting an access need before it
   becomes a problem.
4. **The Collection** — the two-person rule, chain of custody, never alone
   with the offering.
5. **The Communion Procession** — pacing rows, communion to those who cannot
   come forward, the low-gluten host protocol, and what to do if a Host is
   dropped.
6. **Emergencies** — medical episode, AED, calling 911, evacuation routes,
   and the judgment call about when to interrupt Mass.
7. **Difficult Situations** — disruption, intoxicated or unhoused guests
   treated with dignity, solicitation, photography, custody disputes.
8. **Safe Environment and Boundaries** — never alone with a minor, reporting
   obligations, where your diocese's actual policy lives.

**Honesty constraint on the content.** Modules 4, 5, 6, and 8 touch policy that
is diocesan and parish specific. Module 5 is on the list because low-gluten host
and separate-chalice provisions vary parish to parish, and getting that wrong
means somebody either does not receive or gets sick. The curriculum does not
cite Archdiocese of Los Angeles policy, because that policy was not read while
writing it. Each of those modules carries a `policyGap` flag that renders a
standing banner:
*this module describes general practice; your parish's written policy governs,
and your coordinator must fill in the local specifics before anyone is
commissioned on it.* Inventing a citation here would be the most dangerous
possible failure mode, because an usher would believe it.

---

## Build order

1. `schema.sql` + St. Clement seed
2. `functions/_lib/auth.ts`, `db.ts`, catch-all router
3. Route modules: roster, formation, meetings, admin
4. UI: sign-in, dashboard, formation, roster, meetings, admin
5. Local verification with `wrangler pages dev`, then a Tom-gated deploy

## Seed

St. Clement (by-the-Sea), Santa Monica: `st-clement-catholic-church`,
3102 3rd St, 90405, from the `lachurches-org` Places enrichment record
(`ChIJrasOLc66woARs0HEkvFLeTM`). Sunday Mass slots are seeded as
**placeholders** with a visible "unconfirmed" note. The real Mass times were not
read off the parish website while writing this, and a roster built on guessed
Mass times is worse than an empty one.
