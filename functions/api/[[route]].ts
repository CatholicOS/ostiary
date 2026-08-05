// Single entry point for the Ostiary API.
//
// Cloudflare Pages maps this catch-all to /api/*. Route handlers live in
// functions/_lib/routes-*.ts, which Pages does not treat as routes because of
// the leading underscore. Keeping dispatch in one table means the auth posture
// of every endpoint is readable on one screen.

import { handleConfigError, fail, loadSession } from '../_lib/http';
import type { Ctx, Env } from '../_lib/http';
import { deleteSession, getMe, getParishForSignIn, postSession } from '../_lib/routes-session';
import { getRoster, postCover, postDrop, postSignup, postSubRequest } from '../_lib/routes-roster';
import { getFormation, getFormationStatus, postFormationComplete } from '../_lib/routes-formation';
import { getMeetings, postRsvp } from '../_lib/routes-meetings';
import {
    deleteSlot, postAttendance, postMeeting, postParish, postSlot, postUsher,
} from '../_lib/routes-admin';

type Handler = (ctx: Ctx) => Response | Promise<Response>;

const ROUTES: Record<string, Handler> = {
    // public (join code is the only credential)
    'GET parish': getParishForSignIn,
    'POST session': postSession,
    'DELETE session': deleteSession,

    // signed-in usher
    'GET me': getMe,
    'GET roster': getRoster,
    'POST roster/signup': postSignup,
    'POST roster/drop': postDrop,
    'POST roster/sub': postSubRequest,
    'POST roster/cover': postCover,
    'GET formation': getFormation,
    'POST formation/complete': postFormationComplete,
    'GET meetings': getMeetings,
    'POST meetings/rsvp': postRsvp,

    // coordinator (passphrase proven)
    'GET formation/status': getFormationStatus,
    'POST admin/usher': postUsher,
    'POST admin/slot': postSlot,
    'DELETE admin/slot': deleteSlot,
    'POST admin/meeting': postMeeting,
    'POST admin/attendance': postAttendance,
    'POST admin/parish': postParish,
};

export const onRequest: PagesFunction<Env> = async (context) => {
    const { request, env } = context;
    const url = new URL(request.url);

    const segments = context.params.route;
    const route = Array.isArray(segments) ? segments.join('/') : String(segments ?? '');
    const key = `${request.method} ${route}`;

    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: { Allow: 'GET, POST, DELETE' } });
    }

    const handler = ROUTES[key];
    if (!handler) return fail(404, `No API route for ${key}.`);

    try {
        const session = await loadSession(request, env);
        const ctx: Ctx = { request, env, url, route, session };
        return await handler(ctx);
    } catch (err) {
        // A missing SESSION_SECRET is a deployment mistake, not a bug. Say so
        // in plain words instead of returning a generic 500 that sends whoever
        // is debugging into the application code.
        const configured = handleConfigError(err);
        if (configured) return configured;

        console.error('ostiary api error', key, err);
        return fail(500, 'Something went wrong on our end.');
    }
};
