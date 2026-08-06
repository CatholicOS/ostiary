# Deploying Ostiary

Nothing here has been run against Cloudflare. Everything below is verified
locally and is yours to execute.

## Local, which is what was actually tested

```bash
cd ~/workspace/active/ostiary

npm run db:init:local
OSTIARY_ADMIN_PASSPHRASE="local-dev-passphrase" node scripts/seed.mjs --demo > .seed.sql
wrangler d1 execute ostiary-db --local --file=./.seed.sql --persist-to .wrangler/state

wrangler pages dev src --port 8793 --persist-to .wrangler/state \
  --binding SESSION_SECRET="local-dev-secret-at-least-32-bytes-long"

# in another shell
node tests/google.test.mjs  # 50 passed, 0 failed (no server needed)
BASE=http://127.0.0.1:8793 OSTIARY_ADMIN_PASSPHRASE="local-dev-passphrase" \
  node tests/smoke.mjs      # 70 passed, 0 failed (60 + a printed SKIP note on
                            # a rerun: the self-onboarding block caps per day)
```

Google is optional and off by default; without `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` bindings the smoke test expects the honest 503 from
`/api/google/status`. Setup, when a parish wants it, is in
[GOOGLE.md](GOOGLE.md).

Sign in at <http://127.0.0.1:8793> with parish code `CLEMENT`, then either pick
a name or use the coordinator passphrase.

**Do not pass `--d1 DB=ostiary-db` to `pages dev`.** The binding is already in
`wrangler.toml`, and the CLI flag makes miniflare pick a *different* local
sqlite file than `wrangler d1 execute --local` writes to. The symptom is
`no such table: parishes`, which reads like a schema bug and is not one.

## Production

### 1. Create the database

```bash
cd ~/workspace/active/ostiary
wrangler d1 create ostiary-db
```

Copy the printed `database_id` into `wrangler.toml`, replacing the all-zero
placeholder. Leaving the placeholder makes the deploy fail with "D1 database
not found", which is the intended loud failure.

### 2. Schema

```bash
wrangler d1 execute ostiary-db --remote --file=./schema.sql
```

### 3. Seed the parish

Set a real passphrase. Do not use the dev default, and do not pass `--demo`
(those fixtures are labelled "not a real person" and have no business in a
parish database).

```bash
OSTIARY_ADMIN_PASSPHRASE='<a real passphrase>' \
OSTIARY_JOIN_CODE='CLEMENT' \
  node scripts/seed.mjs > .seed.sql

# read it before you run it
less .seed.sql
wrangler d1 execute ostiary-db --remote --file=./.seed.sql
rm .seed.sql          # it contains the passphrase hash
```

### 4. Create the Pages project and its secret

```bash
wrangler pages project create ostiary --production-branch=main

openssl rand -base64 32          # copy this
wrangler pages secret put SESSION_SECRET --project-name=ostiary
```

There is no fallback secret. If `SESSION_SECRET` is unset every authenticated
route returns 503 with a message saying exactly that, rather than signing
cookies with a default that anyone reading this repository could forge.

### 5. Deploy

```bash
npm run deploy
```

### 6. Verify the deployed thing, not the config

```bash
curl -s https://ostiary.pages.dev/api/parish?code=CLEMENT | head -c 300
BASE=https://ostiary.pages.dev OSTIARY_ADMIN_PASSPHRASE='<the real one>' \
  node tests/smoke.mjs
```

The smoke test writes: it creates and deletes a Mass, adds an usher named
"Smoke Test Usher", and saves policy notes. Against production that leaves one
usher row and a policy-note edit behind. Delete the row afterwards or accept it.

It also exercises self-onboarding, which creates up to two parishes named
"Smoke Start Parish <suffix>" and spends that much of the real daily creation
cap. There is no delete endpoint, so cleanup is manual:

```sql
DELETE FROM parishes WHERE name LIKE 'Smoke Start Parish %';
-- Leave parish_starts alone: those rows are what the daily caps count.
```

If the cap is already spent, the block prints a SKIP note and passes.

## First real-use checklist

1. **Confirm the Mass times.** Every seeded slot ships flagged
   `! Time not confirmed`. The seeded Sunday pattern (8:00, 10:00, 12:00
   Spanish) is a plausible guess that was never checked against St. Clement's
   actual schedule. Fix them in the admin screen; confirming clears the flag.
2. **Fill in the parish policy box.** Four formation modules (collection,
   communion, emergencies, safe environment) deliberately leave local specifics
   blank and render a banner saying so. Until you write the AED location,
   where the offering is secured, and your diocesan safe-environment reporting
   number, those four modules are incomplete by design.
3. **Change the passphrase** from the admin screen after the first sign-in.
4. **Add the real team** and delete anything created by a smoke run.

Parishes that arrive through `/start` (self-onboarding) skip step 1 entirely:
they begin with **zero** Mass slots and one coordinator, and that coordinator
builds their own Mass schedule in the admin screen. Steps 2 and 3 still apply
to them; the generated passphrase works but a chosen one is easier to keep.

## What this does not do

No push notifications, no SMS, no email reminders, no calendar export, no
multi-parish onboarding, no native app. The auth model (shared parish code,
no per-person password) is fine for a volunteer usher list and is not fine for
anything sacramental, financial, or safe-environment related.
