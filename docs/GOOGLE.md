# Google setup for Ostiary

Everything Google is optional, per parish. With no Google configuration the
app runs exactly as described in DEPLOY.md: join-code sign-in, no calendar
invites, no group sync, and every `/api/google/*` route answers 503 in plain
words. Nothing below has been run against a production Google Cloud project;
the flows were verified locally against Google's documented endpoints.

## What connecting Google adds

1. **Sign in with Google.** An usher whose email the coordinator already put
   on the roster can sign in with their Google account instead of the parish
   code. Nobody is ever created from Google sign-in; an unknown email is told
   to ask the coordinator. The join-code flow remains and remains the
   fallback. Google sign-in proves identity, not authority: coordinators still
   enter the passphrase for the admin screen.
2. **Calendar invites with a Meet link.** A coordinator who connects a Google
   account can tick "send calendar invites" on a meeting. Every active usher
   with an email gets a real Google Calendar invite carrying a Meet link, and
   "Sync RSVPs" copies their accepted/declined/tentative replies back into
   Ostiary. Works with any Google account, gmail.com included.
3. **Group sync.** If the parish is on Google Workspace and the connected
   account can manage a group (for example `ushers@yourparish.org`), "Sync
   group now" reconciles the group's membership to the active roster. This one
   needs Workspace; a plain gmail.com parish gets calendar and Meet only, and
   the UI says so instead of failing cryptically.

## Google Cloud project

1. Create a project at <https://console.cloud.google.com>, or reuse one the
   parish already has.
2. **Enable APIs** (APIs and Services, Library):
   - Google Calendar API (for invites and Meet links)
   - Cloud Identity API (only if group sync will be used)
3. **OAuth consent screen** (APIs and Services, OAuth consent screen):
   - *Internal* if the parish has Google Workspace and only Workspace members
     will sign in. No verification process, no test-user list.
   - *External* otherwise. While the app is in Testing status only listed test
     users can sign in, and refresh tokens expire after 7 days, which breaks
     calendar invites quietly. For real use, publish the app. Publishing with
     only non-sensitive scopes plus `calendar.events` may trigger Google's
     verification review; answer it honestly, it is a parish scheduling tool.
   - Scopes to declare: `openid`, `email`, `profile`,
     `https://www.googleapis.com/auth/calendar.events`, and, only if group
     sync will be used, `https://www.googleapis.com/auth/cloud-identity.groups`.
4. **Credentials**: create an OAuth client ID, type "Web application".
   - Authorized redirect URI: `https://ostiary.pages.dev/api/google/callback`
     (add the custom domain later as a second entry, and
     `http://127.0.0.1:8793/api/google/callback` if you want to test locally).
   - Copy the client ID and client secret.

## Secrets

```bash
wrangler pages secret put GOOGLE_CLIENT_ID --project-name=ostiary
wrangler pages secret put GOOGLE_CLIENT_SECRET --project-name=ostiary
```

Locally, add bindings to the `pages dev` command from DEPLOY.md:

```bash
wrangler pages dev src --port 8793 --persist-to .wrangler/state \
  --binding SESSION_SECRET="local-dev-secret-at-least-32-bytes-long" \
  --binding GOOGLE_CLIENT_ID="<client id>" \
  --binding GOOGLE_CLIENT_SECRET="<client secret>"
```

Unset, the app does not degrade; the Google surface simply is not there.

## What requires Workspace and what does not

| Capability | Any Google account | Google Workspace |
|---|---|---|
| Sign in with Google | yes | yes |
| Calendar invites + Meet link | yes | yes |
| RSVP sync | yes | yes |
| Group sync | no | yes, and the connected account needs manager rights on the group |

## The SESSION_SECRET rotation caveat

The parish's Google refresh token is stored AES-GCM encrypted under a key
derived from `SESSION_SECRET` (HKDF, info string `ostiary-google-token`).
Rotating `SESSION_SECRET` therefore makes every stored token unreadable, on
purpose: there is no second key to manage and no plaintext fallback. The
symptom is an honest "reconnect Google" error; the fix is the coordinator
pressing Disconnect and then Connect again. Nothing else is lost.

## Honest limits

- Calendar events are created with a one-hour duration, because meetings in
  Ostiary have a start time and no end time.
- RSVP sync is pull, not push: someone presses the button; there is no
  webhook.
- Disconnect revokes the token at Google on a best-effort basis and deletes
  the stored copy either way.
- Google sign-in matches by email, which is the same trust level as the
  roster itself: whoever controls that mailbox is that usher. The `sub` claim
  is recorded on first sign-in but is not yet enforced as a second factor.
