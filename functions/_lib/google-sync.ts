// The jobs that reconcile Ostiary state with Google state: a meeting onto the
// parish calendar (with a Meet link), attendee replies back into RSVPs, and
// the roster into a Workspace group. Every failure from Google surfaces as an
// honest JSON error carrying Google's own explanation; nothing here reports a
// success it did not verify.

import { fail, newId, nowSeconds, ok, requireAdmin } from './http';
import type { Ctx } from './http';
import {
    CALENDAR_API, CLOUD_IDENTITY_API, GoogleApiError, SCOPE_GROUPS,
    apiCall, googleCreds, mapResponseStatus,
} from './google-api';
import { RECONNECT_MESSAGE, accessTokenFor, googleConnection } from './routes-google';
import type { ConnectionRow } from './routes-google';

/** Meetings have no duration column, so the calendar event gets one hour.
 *  A wrong end time on an invite is a smaller lie than a wrong start time,
 *  and the start time is real. */
const EVENT_DURATION_SECONDS = 3600;

interface GoogleReady {
    row: ConnectionRow;
    token: string;
}

/** Everything a sync needs, or a thrown GoogleApiError that says exactly
 *  which precondition failed. */
async function requireGoogle(ctx: Ctx): Promise<GoogleReady> {
    const creds = googleCreds(ctx.env);
    if (!creds) {
        throw new GoogleApiError(503,
            'Google is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
    }
    const row = await googleConnection(ctx);
    if (!row) throw new GoogleApiError(400, 'Google is not connected for this parish.');
    const token = await accessTokenFor(ctx.env, creds, row);
    if (!token) throw new GoogleApiError(409, RECONNECT_MESSAGE);
    return { row, token };
}

function asGoogleFailure(err: unknown): Response | null {
    if (!(err instanceof GoogleApiError)) return null;
    // Preconditions keep their own status; upstream Google failures are 502,
    // because the broken thing is not this server and not the request.
    const status = [400, 409, 503].includes(err.status) ? err.status : 502;
    return fail(status, err.message);
}

// ---------------------------------------------------------------------------
// Meeting -> Calendar
// ---------------------------------------------------------------------------

interface MeetingRow {
    id: string; starts_at: number; title: string; location: string | null;
    agenda_md: string | null; gcal_event_id: string | null;
}

function eventBody(meeting: MeetingRow, timezone: string, attendees: { email: string }[]) {
    const start = new Date(meeting.starts_at * 1000).toISOString();
    const end = new Date((meeting.starts_at + EVENT_DURATION_SECONDS) * 1000).toISOString();
    return {
        summary: meeting.title,
        location: meeting.location ?? undefined,
        description: meeting.agenda_md ?? undefined,
        start: { dateTime: start, timeZone: timezone },
        end: { dateTime: end, timeZone: timezone },
        attendees,
    };
}

/** Create or update the calendar event for a meeting, invite every active
 *  usher with an email, ask Google for a Meet link, and record both ids on the
 *  meeting row. Throws GoogleApiError; the caller turns it into JSON. */
export async function pushMeetingToCalendar(
    ctx: Ctx, meetingId: string,
): Promise<{ gcal_event_id: string; meet_link: string | null; invited: number }> {
    const { row, token } = await requireGoogle(ctx);

    const meeting = await ctx.env.DB.prepare(
        `SELECT id, starts_at, title, location, agenda_md, gcal_event_id
         FROM meetings WHERE id = ?1 AND parish_id = ?2`,
    ).bind(meetingId, ctx.session!.p).first<MeetingRow>();
    if (!meeting) throw new GoogleApiError(404, 'No such meeting at your parish.');

    const parish = await ctx.env.DB.prepare(
        `SELECT timezone FROM parishes WHERE id = ?1`,
    ).bind(ctx.session!.p).first<{ timezone: string }>();

    const { results: people } = await ctx.env.DB.prepare(
        `SELECT email FROM ushers
         WHERE parish_id = ?1 AND active = 1 AND email IS NOT NULL`,
    ).bind(ctx.session!.p).all<{ email: string }>();
    const attendees = (people ?? []).map((p) => ({ email: p.email }));

    const base = `${CALENDAR_API}/calendars/${encodeURIComponent(row.calendar_id)}/events`;
    const query = 'conferenceDataVersion=1&sendUpdates=all';
    const body = eventBody(meeting, parish?.timezone ?? 'UTC', attendees);

    let event: Record<string, unknown> | null = null;
    if (meeting.gcal_event_id) {
        try {
            event = await apiCall(token, 'PATCH',
                `${base}/${encodeURIComponent(meeting.gcal_event_id)}?${query}`, body);
        } catch (err) {
            // The event was deleted on the Google side; fall through and make a
            // fresh one rather than failing a meeting edit over a stale id.
            if (!(err instanceof GoogleApiError) || (err.status !== 404 && err.status !== 410)) {
                throw err;
            }
        }
    }
    if (!event) {
        event = await apiCall(token, 'POST', `${base}?${query}`, {
            ...body,
            conferenceData: {
                createRequest: {
                    requestId: crypto.randomUUID(),
                    conferenceSolutionKey: { type: 'hangoutsMeet' },
                },
            },
        });
    }

    const eventId = typeof event?.id === 'string' ? event.id : null;
    if (!eventId) throw new GoogleApiError(502, 'Google returned an event without an id.');
    const meetLink = typeof event?.hangoutLink === 'string' ? event.hangoutLink : null;

    await ctx.env.DB.prepare(
        `UPDATE meetings SET gcal_event_id = ?2, meet_link = ?3, updated_at = ?4 WHERE id = ?1`,
    ).bind(meeting.id, eventId, meetLink, nowSeconds()).run();

    return { gcal_event_id: eventId, meet_link: meetLink, invited: attendees.length };
}

/** Cancel the event behind a meeting being deleted. Attendees get the
 *  cancellation email. An event already gone on Google's side counts as
 *  cancelled, not as a failure. */
export async function cancelMeetingEvent(ctx: Ctx, gcalEventId: string): Promise<void> {
    const { row, token } = await requireGoogle(ctx);
    try {
        await apiCall(token, 'DELETE',
            `${CALENDAR_API}/calendars/${encodeURIComponent(row.calendar_id)}/events/`
            + `${encodeURIComponent(gcalEventId)}?sendUpdates=all`);
    } catch (err) {
        if (err instanceof GoogleApiError && (err.status === 404 || err.status === 410)) return;
        throw err;
    }
}

// ---------------------------------------------------------------------------
// RSVP sync
// ---------------------------------------------------------------------------

/** POST /api/google/meetings/:id/sync-rsvps  (coordinator only)
 *  Reads the event's attendees and writes accepted/declined/tentative into
 *  meeting_rsvps as yes/no/maybe by case-insensitive email match. Reports the
 *  counts honestly, including attendees who matched nobody on the roster. */
export async function postSyncRsvps(ctx: Ctx, meetingId: string): Promise<Response> {
    const guard = requireAdmin(ctx); if (guard) return guard;

    const meeting = await ctx.env.DB.prepare(
        `SELECT id, gcal_event_id FROM meetings WHERE id = ?1 AND parish_id = ?2`,
    ).bind(meetingId, ctx.session!.p).first<{ id: string; gcal_event_id: string | null }>();
    if (!meeting) return fail(404, 'No such meeting at your parish.');
    if (!meeting.gcal_event_id) {
        return fail(400, 'This meeting has no calendar event, so there is nothing to sync.');
    }

    try {
        const { row, token } = await requireGoogle(ctx);
        const event = await apiCall(token, 'GET',
            `${CALENDAR_API}/calendars/${encodeURIComponent(row.calendar_id)}/events/`
            + `${encodeURIComponent(meeting.gcal_event_id)}`);

        const attendees = Array.isArray(event?.attendees)
            ? (event!.attendees as { email?: string; responseStatus?: string; resource?: boolean }[])
            : [];

        const { results: people } = await ctx.env.DB.prepare(
            `SELECT id, email FROM ushers
             WHERE parish_id = ?1 AND active = 1 AND email IS NOT NULL`,
        ).bind(ctx.session!.p).all<{ id: string; email: string }>();
        const byEmail = new Map((people ?? []).map((p) => [p.email.toLowerCase(), p.id]));

        const now = nowSeconds();
        const statements = [];
        let unmatched = 0;
        let pending = 0;
        for (const a of attendees) {
            if (!a.email || a.resource) continue;
            const status = mapResponseStatus(a.responseStatus);
            if (!status) { pending++; continue; }
            const usherId = byEmail.get(a.email.toLowerCase());
            if (!usherId) { unmatched++; continue; }
            statements.push(ctx.env.DB.prepare(
                `INSERT INTO meeting_rsvps (id, meeting_id, usher_id, status, attended, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 0, ?5)
                 ON CONFLICT (meeting_id, usher_id)
                 DO UPDATE SET status = ?4, updated_at = ?5`,
            ).bind(newId('rsvp'), meeting.id, usherId, status, now));
        }
        if (statements.length) await ctx.env.DB.batch(statements);

        return ok({ updated: statements.length, unmatched, pending });
    } catch (err) {
        const failure = asGoogleFailure(err);
        if (failure) return failure;
        throw err;
    }
}

// ---------------------------------------------------------------------------
// Group sync (Google Workspace only)
// ---------------------------------------------------------------------------

/** POST /api/google/group/sync  (coordinator only)
 *  Reconciles the Workspace group to the active roster: adds active ushers
 *  with an email, removes members no longer on the roster, and never removes
 *  the connected coordinator's own membership. Requires Google Workspace and
 *  a connected account with manager rights on the group; a plain gmail.com
 *  parish gets calendar and Meet only, and the error below says so instead of
 *  failing cryptically. */
export async function postGoogleGroupSync(ctx: Ctx): Promise<Response> {
    const guard = requireAdmin(ctx); if (guard) return guard;

    try {
        const { row, token } = await requireGoogle(ctx);
        if (!row.group_email) {
            return fail(400, 'Set a Google Group email first, in the Google card.');
        }
        if (!row.scopes.includes(SCOPE_GROUPS)) {
            return fail(400,
                'The Google connection was made without the group scope. Disconnect, then '
                + 'connect again with group sync enabled. Group sync needs Google Workspace; '
                + 'a plain gmail.com account cannot use it.');
        }

        let group: Record<string, unknown> | null;
        try {
            group = await apiCall(token, 'GET',
                `${CLOUD_IDENTITY_API}/groups:lookup?groupKey.id=`
                + encodeURIComponent(row.group_email));
        } catch (err) {
            if (err instanceof GoogleApiError) {
                return fail(502,
                    `Google could not find or open the group ${row.group_email}: ${err.message} `
                    + 'Group sync needs a Google Workspace group the connected account can manage.');
            }
            throw err;
        }
        const groupName = typeof group?.name === 'string' ? group.name : null;
        if (!groupName) return fail(502, 'Google returned no group id for that email.');

        // Current memberships, paginated. The cap is a guard against a runaway
        // loop, not a real limit; 20 pages is 4,000 members.
        const members = new Map<string, string>(); // email -> membership resource name
        let pageToken: string | null = null;
        for (let page = 0; page < 20; page++) {
            const url = `${CLOUD_IDENTITY_API}/${groupName}/memberships?pageSize=200`
                + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
            const data = await apiCall(token, 'GET', url);
            const list = Array.isArray(data?.memberships)
                ? (data!.memberships as { name?: string; preferredMemberKey?: { id?: string } }[])
                : [];
            for (const m of list) {
                if (m.name && m.preferredMemberKey?.id) {
                    members.set(m.preferredMemberKey.id.toLowerCase(), m.name);
                }
            }
            pageToken = typeof data?.nextPageToken === 'string' ? data.nextPageToken : null;
            if (!pageToken) break;
        }

        const { results: people } = await ctx.env.DB.prepare(
            `SELECT email FROM ushers WHERE parish_id = ?1 AND active = 1`,
        ).bind(ctx.session!.p).all<{ email: string | null }>();
        const roster = new Set(
            (people ?? []).filter((p) => p.email).map((p) => p.email!.toLowerCase()),
        );
        const skippedNoEmail = (people ?? []).filter((p) => !p.email).length;

        const failures: { email: string; op: 'add' | 'remove'; error: string }[] = [];
        let added = 0;
        let removed = 0;
        let keptOwner = 0;

        for (const email of roster) {
            if (members.has(email)) continue;
            try {
                await apiCall(token, 'POST', `${CLOUD_IDENTITY_API}/${groupName}/memberships`, {
                    preferredMemberKey: { id: email },
                    roles: [{ name: 'MEMBER' }],
                });
                added++;
            } catch (err) {
                if (!(err instanceof GoogleApiError)) throw err;
                failures.push({ email, op: 'add', error: err.message });
            }
        }

        const owner = row.connected_email.toLowerCase();
        for (const [email, membershipName] of members) {
            if (roster.has(email)) continue;
            if (email === owner) { keptOwner = 1; continue; } // never lock the owner out
            try {
                await apiCall(token, 'DELETE', `${CLOUD_IDENTITY_API}/${membershipName}`);
                removed++;
            } catch (err) {
                if (!(err instanceof GoogleApiError)) throw err;
                failures.push({ email, op: 'remove', error: err.message });
            }
        }

        return ok({
            added, removed, kept_owner: keptOwner === 1,
            skipped_no_email: skippedNoEmail, failures,
        });
    } catch (err) {
        const failure = asGoogleFailure(err);
        if (failure) return failure;
        throw err;
    }
}
