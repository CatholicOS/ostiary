# Ostiary

Usher formation and meeting organization for Catholic parishes. Named for the
*ostiarius*, the doorkeeper, a minor order of the Latin Church until 1972.

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
node tests/smoke.mjs     # 50 assertions
```

Four of the eight modules (collection, communion, emergencies, safe
environment) describe general practice only and render a standing banner
saying so. They cite no diocesan policy because none was read while writing
them. The coordinator fills in the local specifics.

Ostiary is a signed-in parish tool, not a public directory, so unlike its sibling
Ephphatha it does not server-render: every screen is built in the browser and
every page carries a `<noscript>` saying so and pointing at the printable roster.
`robots.txt` disallows everything, because the roster carries volunteers' names.
