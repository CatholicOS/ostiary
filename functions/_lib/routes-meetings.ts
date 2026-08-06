// Meetings: agendas, minutes, RSVPs, attendance.

import { clean, fail, newId, nowSeconds, ok, readJson, requireUsher } from './http';
import type { Ctx } from './http';

interface MeetingRow {
    id: string; starts_at: number; title: string; location: string | null;
    agenda_md: string | null; minutes_md: string | null;
    gcal_event_id: string | null; meet_link: string | null;
}

/** GET /api/meetings?past=1
 *  Upcoming by default. `past=1` returns the archive, newest first, because
 *  the reason to open a past meeting is almost always to read its minutes. */
export async function getMeetings(ctx: Ctx): Promise<Response> {
    const guard = requireUsher(ctx); if (guard) return guard;

    const past = ctx.url.searchParams.get('past') === '1';
    const now = nowSeconds();

    const { results: meetings } = await ctx.env.DB.prepare(
        past
            ? `SELECT id, starts_at, title, location, agenda_md, minutes_md,
                      gcal_event_id, meet_link FROM meetings
               WHERE parish_id = ?1 AND starts_at < ?2 ORDER BY starts_at DESC LIMIT 25`
            : `SELECT id, starts_at, title, location, agenda_md, minutes_md,
                      gcal_event_id, meet_link FROM meetings
               WHERE parish_id = ?1 AND starts_at >= ?2 ORDER BY starts_at LIMIT 25`,
    ).bind(ctx.session!.p, now).all<MeetingRow>();

    if (!meetings || meetings.length === 0) return ok({ meetings: [], past });

    const placeholders = meetings.map((_, i) => `?${i + 1}`).join(',');
    const { results: rsvps } = await ctx.env.DB.prepare(
        `SELECT r.meeting_id, r.usher_id, r.status, r.attended, u.name
         FROM meeting_rsvps r JOIN ushers u ON u.id = r.usher_id
         WHERE r.meeting_id IN (${placeholders}) ORDER BY u.name`,
    ).bind(...meetings.map((m) => m.id)).all<{
        meeting_id: string; usher_id: string; status: string; attended: number; name: string;
    }>();

    const byMeeting = new Map<string, typeof rsvps>();
    for (const r of rsvps ?? []) {
        const list = byMeeting.get(r.meeting_id) ?? [];
        list!.push(r);
        byMeeting.set(r.meeting_id, list);
    }

    const me = ctx.session!.u;
    return ok({
        past,
        meetings: meetings.map((m) => {
            const list = byMeeting.get(m.id) ?? [];
            // The event id itself stays server-side; the client only needs to
            // know whether an event exists and where the Meet link points.
            const { gcal_event_id, ...rest } = m;
            return {
                ...rest,
                has_calendar_event: !!gcal_event_id,
                rsvps: (list ?? []).map((r) => ({
                    usher_id: r.usher_id, name: r.name,
                    status: r.status, attended: r.attended === 1,
                })),
                counts: {
                    yes: (list ?? []).filter((r) => r.status === 'yes').length,
                    no: (list ?? []).filter((r) => r.status === 'no').length,
                    maybe: (list ?? []).filter((r) => r.status === 'maybe').length,
                },
                my_rsvp: (list ?? []).find((r) => r.usher_id === me)?.status ?? null,
            };
        }),
    });
}

/** POST /api/meetings/rsvp { meeting_id, status } */
export async function postRsvp(ctx: Ctx): Promise<Response> {
    const guard = requireUsher(ctx); if (guard) return guard;

    const body = await readJson<{ meeting_id?: string; status?: string }>(ctx.request);
    const meetingId = clean(body?.meeting_id, 80);
    const status = clean(body?.status, 10);

    if (!meetingId) return fail(400, 'meeting_id required.');
    if (!status || !['yes', 'no', 'maybe'].includes(status)) {
        return fail(400, 'status must be yes, no, or maybe.');
    }

    // Scope the meeting to the caller's parish before writing, so a valid
    // session at parish A cannot RSVP to parish B's meeting by guessing an id.
    const meeting = await ctx.env.DB.prepare(
        `SELECT id FROM meetings WHERE id = ?1 AND parish_id = ?2`,
    ).bind(meetingId, ctx.session!.p).first<{ id: string }>();
    if (!meeting) return fail(404, 'No such meeting at your parish.');

    const now = nowSeconds();
    await ctx.env.DB.prepare(
        `INSERT INTO meeting_rsvps (id, meeting_id, usher_id, status, attended, updated_at)
         VALUES (?1, ?2, ?3, ?4, 0, ?5)
         ON CONFLICT (meeting_id, usher_id)
         DO UPDATE SET status = ?4, updated_at = ?5`,
    ).bind(newId('rsvp'), meetingId, ctx.session!.u, status, now).run();

    return ok({ meeting_id: meetingId, status });
}
