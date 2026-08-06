# Security

## Reporting

Report vulnerabilities privately through GitHub security advisories on this
repository rather than public issues. Reports are read by the maintainers of
the Catholic Digital Commons Foundation.

## What the security model honestly is

Ostiary protects a volunteer usher roster: names, optional emails and
phone numbers, and who attended which meeting. Its model is stated in
[docs/PLAN.md](docs/PLAN.md) and is deliberate:

- Ushers sign in with a shared parish join code and pick their name. This
  is shoulder-surf resistant, not attacker resistant: anyone holding a
  parish's join code can read that parish's roster and sign up for a Mass.
- Coordinator authority requires a passphrase (PBKDF2, at the Workers
  runtime's 100,000-iteration cap) or, where configured, a verified Google
  identity on the `OWNER_EMAILS` allowlist.
- Sessions are HMAC-signed cookies under `SESSION_SECRET`; there is no
  fallback secret, and an unset secret disables authenticated routes
  rather than weakening them.
- Google refresh tokens are encrypted at rest with AES-GCM under a key
  derived from `SESSION_SECRET`; rotating the secret invalidates them.
- `robots.txt` disallows everything, because rosters carry volunteers'
  names.

The app must never be extended to hold sacramental, financial, or
safe-environment case data under this model. That line is load-bearing;
reports that show it being crossed are as welcome as exploits.
