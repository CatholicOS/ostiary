# Ostiary

Usher formation and meeting organization for Catholic parishes — a project of
the [Catholic Digital Commons Foundation](https://github.com/CatholicOS). Named
for the *ostiarius*, the doorkeeper, a minor order of the Latin Church until
1972.

Eight formation modules with per-person progress, Mass-by-Mass rosters ushers
sign up for themselves, sub requests, and team meetings with agendas, minutes,
and attendance.

Cloudflare Pages + D1 + plain HTML + TypeScript Pages Functions.

- [docs/PLAN.md](docs/PLAN.md) — architecture, schema, and what the curriculum
  deliberately does not know
- [docs/DEPLOY.md](docs/DEPLOY.md) — local setup and the production runbook

```bash
npm run setup:local
npm run dev
node tests/google.test.mjs   # 45 unit assertions, no server needed
node tests/smoke.mjs         # 56 assertions against the running stack
```

Four of the eight modules (collection, communion, emergencies, safe
environment) describe general practice only and render a standing banner
saying so. They cite no diocesan policy because none was read while writing
them. The coordinator fills in the local specifics.

A parish can optionally connect Google (docs/GOOGLE.md): ushers already on the
roster may sign in with their Google account, meeting invites go out on Google
Calendar with a Meet link and RSVP sync, and Workspace parishes can keep a
Google Group reconciled to the roster. With no Google configuration the app
runs exactly as before; the join-code sign-in always remains.

Ostiary is a signed-in parish tool, not a public directory, so it does not
server-render: every screen is built in the browser and every page carries a
`<noscript>` saying so and pointing at the printable roster. `robots.txt`
disallows everything, because the roster carries volunteers' names.

Licensed under the [Apache License 2.0](LICENSE).
