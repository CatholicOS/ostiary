# Contributing to Ostiary

Ostiary is a project of the [Catholic Digital Commons
Foundation](https://github.com/CatholicOS). Contributions are welcome:
issues, corrections, translations, and code.

## Running it locally

Everything is in [docs/DEPLOY.md](docs/DEPLOY.md), section "Local, which is
what was actually tested." The short version:

```bash
npm install
npm run setup:local     # schema + demo seed into a local sqlite
npm run dev             # wrangler pages dev on :8788
node tests/google.test.mjs                                   # unit, no server
BASE=http://127.0.0.1:8788 OSTIARY_ADMIN_PASSPHRASE="local-dev-passphrase" \
  node tests/smoke.mjs                                       # against the stack
```

Sign in with parish code `CLEMENT`; the demo coordinator passphrase is
`local-dev-passphrase`.

## Deploying your own instance

[docs/DEPLOY.md](docs/DEPLOY.md) is the complete runbook: one D1 database,
one Pages project, one secret. [docs/GOOGLE.md](docs/GOOGLE.md) adds the
optional Google layer. Two things to change in a fork:

- `OWNER_EMAILS` in `wrangler.toml`: set your own address or empty it.
  A verified Google sign-in matching this list gets coordinator authority.
- The `database_id` in `wrangler.toml`, printed by `wrangler d1 create`.

One production gotcha the local stack will not show you: remote D1 rejects
SQL `BEGIN TRANSACTION` statements, and the Workers runtime caps PBKDF2 at
100,000 iterations. Both are already accounted for in the code; keep them in
mind when changing the seed or the auth.

## House rules

The codebase holds a few rules on purpose. Pull requests that break them
will be asked to change, so it is cheaper to know them first:

- **No runtime dependencies.** Plain HTML, one stylesheet, small per-page
  scripts, TypeScript Pages Functions, Web Crypto. `wrangler` is the only
  dev dependency. If a feature seems to need a package, it probably needs a
  smaller feature.
- **Every file stays under 500 lines.** Split before you cross it.
- **Both themes, always.** Light and dark are both first-class: 4.5:1 on
  body text, 3:1 on UI boundaries, verified in both before a change ships.
- **Phones are the primary device.** Nothing interactive under 44px on
  coarse pointers; no horizontal page scroll at 360px; wide tables scroll
  inside their own container with a visible affordance.
- **No emoji, anywhere.** Including empty states and buttons.
- **Copy is plain, humble, and honest.** No marketing language, and the
  software never claims to know what it does not (the formation modules
  that describe general practice say so on their face).
- **Citations are verified or unlinked.** A source link is keyed only after
  the URL was fetched and the cited passage confirmed in the fetched text.
  An honest unlinked citation beats a guessed link.
- **Errors are honest.** A failed write never reports success; a
  misconfigured integration answers with what is missing, not a stack trace.

## Content contributions

The formation curriculum lives in `functions/_lib/curriculum.ts` and its
citations in `functions/_lib/curriculum-citations.ts`, in git rather than in
the database, so that a pastor can review a diff. Corrections to liturgical
or canonical claims are especially welcome; cite the source, and expect the
citation to be checked against the document before merge.

## Tests

CI runs the unit suite and the smoke suite on every push and pull request
(`.github/workflows/ci.yml`). The smoke suite runs against a real local
stack and writes real rows; new features should extend it. If your change
touches served HTML, keep the ids, classes, and data attributes the tests
and page scripts rely on, or update all of them together.
