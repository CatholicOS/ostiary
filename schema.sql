-- Ostiary: usher formation and meeting organization.
-- D1 (SQLite). Times are stored as INTEGER unix seconds, UTC. Never local.
--
-- This database holds parishioner names, emails, and phone numbers. It is
-- deliberately separate from lachurches-db (a public church directory).
-- Do not add sacramental, financial, or safe-environment records here; the
-- auth model (see docs/PLAN.md) is not strong enough to carry them.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Parish
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parishes (
  id                TEXT PRIMARY KEY,
  slug              TEXT NOT NULL UNIQUE,      -- matches lachurches.org slug where one exists
  name              TEXT NOT NULL,
  city              TEXT,
  state             TEXT NOT NULL DEFAULT 'CA',
  country           TEXT,
  timezone          TEXT NOT NULL DEFAULT 'America/Los_Angeles',

  -- Usher sign-in: the code a coordinator gives the team.
  join_code         TEXT NOT NULL UNIQUE,

  -- Coordinator sign-in: PBKDF2-SHA256, stored as "iterations:saltB64:hashB64".
  admin_hash        TEXT,

  -- Free text the coordinator fills in; rendered on the policy-gap modules.
  policy_notes      TEXT,

  -- 0 for a parish that created itself through /api/parish/start, 1 once a
  -- platform owner has looked at it (or when an operator created it). Nothing
  -- gates on this yet; it exists so unreviewed parishes can be listed later.
  reviewed          INTEGER NOT NULL DEFAULT 0 CHECK (reviewed IN (0, 1)),

  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- Self-onboarding ledger
-- One row per parish created through POST /api/parish/start. This is what the
-- daily caps count against (2 per caller, 20 global, per 24 hours).
--
-- ip_hash is HMAC-SHA256 of the caller's IP under SESSION_SECRET. The raw IP
-- is never stored anywhere: the hash can answer "same caller today?" and
-- nothing else. origin_note is the user-agent, truncated, kept only so a
-- platform owner reviewing abuse has something to read.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parish_starts (
  id                TEXT PRIMARY KEY,
  -- Which parish this creation produced. No FK on purpose: the ledger should
  -- survive a parish being deleted, or the caps forget the creation happened.
  parish_id         TEXT,
  ip_hash           TEXT NOT NULL,
  origin_note       TEXT,
  created_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_parish_starts_time ON parish_starts(created_at);
CREATE INDEX IF NOT EXISTS idx_parish_starts_ip   ON parish_starts(ip_hash, created_at);

-- Operator-created parishes predate the reviewed flag and count as reviewed.
-- Self-onboarded parishes are exactly the ones recorded in parish_starts, so
-- this is safe to re-run: it never promotes a parish that created itself.
-- (On a fresh database it touches zero rows. On a live database the reviewed
-- column arrives by ALTER first; see docs/DEPLOY.md.)
UPDATE parishes SET reviewed = 1
WHERE id NOT IN (SELECT parish_id FROM parish_starts WHERE parish_id IS NOT NULL);

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ushers (
  id                TEXT PRIMARY KEY,
  parish_id         TEXT NOT NULL,
  name              TEXT NOT NULL,
  email             TEXT,
  phone             TEXT,
  -- usher | captain | coordinator. captain leads a Mass team; coordinator admins.
  role              TEXT NOT NULL DEFAULT 'usher'
                    CHECK (role IN ('usher', 'captain', 'coordinator')),
  -- Comma-separated ISO-639-1 codes, e.g. "en,es". Matched against mass_slots.language.
  languages         TEXT NOT NULL DEFAULT 'en',
  active            INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  notes             TEXT,
  -- Google account id (the OIDC `sub` claim), recorded on first Google
  -- sign-in. The matched credential is the email; this is a record, not a key.
  google_sub        TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  FOREIGN KEY (parish_id) REFERENCES parishes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ushers_parish ON ushers(parish_id, active);

-- ---------------------------------------------------------------------------
-- Serving slots
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mass_slots (
  id                TEXT PRIMARY KEY,
  parish_id         TEXT NOT NULL,
  starts_at         INTEGER NOT NULL,          -- unix seconds, UTC
  label             TEXT NOT NULL,             -- "Sunday 10:00 Sung Mass"
  language          TEXT NOT NULL DEFAULT 'en',
  ushers_needed     INTEGER NOT NULL DEFAULT 4 CHECK (ushers_needed > 0),
  notes             TEXT,
  -- 1 when the Mass time itself has not been confirmed against the parish.
  -- Seeded slots start unconfirmed on purpose; see docs/PLAN.md.
  unconfirmed_time  INTEGER NOT NULL DEFAULT 0 CHECK (unconfirmed_time IN (0, 1)),
  created_at        INTEGER NOT NULL,
  FOREIGN KEY (parish_id) REFERENCES parishes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_slots_parish_time ON mass_slots(parish_id, starts_at);

CREATE TABLE IF NOT EXISTS assignments (
  id                TEXT PRIMARY KEY,
  slot_id           TEXT NOT NULL,
  usher_id          TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'assigned'
                    CHECK (status IN ('assigned', 'confirmed', 'sub_requested', 'dropped')),
  sub_reason        TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  FOREIGN KEY (slot_id)  REFERENCES mass_slots(id) ON DELETE CASCADE,
  FOREIGN KEY (usher_id) REFERENCES ushers(id)     ON DELETE CASCADE,
  -- One row per person per slot. Re-signing up after dropping updates in place.
  UNIQUE (slot_id, usher_id)
);
CREATE INDEX IF NOT EXISTS idx_assignments_usher ON assignments(usher_id, status);

-- ---------------------------------------------------------------------------
-- Formation
-- Module *content* is not stored here. It lives in functions/_lib/curriculum.ts
-- so a pastor can review it as a diff. Only progress is persisted.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS formation_progress (
  id                TEXT PRIMARY KEY,
  usher_id          TEXT NOT NULL,
  module_slug       TEXT NOT NULL,
  completed_at      INTEGER NOT NULL,
  score             INTEGER,                   -- self-check: correct answers
  score_max         INTEGER,
  FOREIGN KEY (usher_id) REFERENCES ushers(id) ON DELETE CASCADE,
  UNIQUE (usher_id, module_slug)
);

-- ---------------------------------------------------------------------------
-- Meetings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meetings (
  id                TEXT PRIMARY KEY,
  parish_id         TEXT NOT NULL,
  starts_at         INTEGER NOT NULL,
  title             TEXT NOT NULL,
  location          TEXT,
  agenda_md         TEXT,
  minutes_md        TEXT,
  -- Set when the coordinator chose "send calendar invites" and the event was
  -- actually created on Google Calendar. NULL means no event, honestly.
  gcal_event_id     TEXT,
  meet_link         TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  FOREIGN KEY (parish_id) REFERENCES parishes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_meetings_parish_time ON meetings(parish_id, starts_at);

-- ---------------------------------------------------------------------------
-- Google (optional, per parish)
-- One row per parish that connected a Google account from the admin screen.
-- The refresh token is encrypted at rest with AES-GCM under a key derived
-- from SESSION_SECRET (HKDF, info "ostiary-google-token"). Rotating
-- SESSION_SECRET therefore invalidates every stored token; the remedy is the
-- coordinator pressing Connect again, not a data migration.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS google_connections (
  parish_id                 TEXT PRIMARY KEY,
  connected_email           TEXT NOT NULL,
  refresh_token_ciphertext  TEXT NOT NULL,     -- base64
  refresh_token_iv          TEXT NOT NULL,     -- 12 random bytes, base64
  scopes                    TEXT NOT NULL,     -- space-separated, as granted
  calendar_id               TEXT NOT NULL DEFAULT 'primary',
  group_email               TEXT,              -- Workspace group to reconcile, or NULL
  created_at                INTEGER NOT NULL,
  updated_at                INTEGER NOT NULL,
  FOREIGN KEY (parish_id) REFERENCES parishes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS meeting_rsvps (
  id                TEXT PRIMARY KEY,
  meeting_id        TEXT NOT NULL,
  usher_id          TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'maybe'
                    CHECK (status IN ('yes', 'no', 'maybe')),
  attended          INTEGER NOT NULL DEFAULT 0 CHECK (attended IN (0, 1)),
  updated_at        INTEGER NOT NULL,
  FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
  FOREIGN KEY (usher_id)   REFERENCES ushers(id)   ON DELETE CASCADE,
  UNIQUE (meeting_id, usher_id)
);
