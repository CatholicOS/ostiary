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
    deleteMeeting, deleteSlot, postAttendance, postMeeting, postParish, postSlot, postUsher,
} from '../_lib/routes-admin';
import { getParishStartHealth, postParishStart } from '../_lib/routes-start';
import {
    getGoogleCallback, getGoogleConnect, getGoogleSignin, getGoogleStatus,
    postGoogleDisconnect, postGoogleGroup,
} from '../_lib/routes-google';
import { postGoogleGroupSync, postSyncRsvps } from '../_lib/google-sync';

type Handler = (ctx: Ctx) => Response | Promise<Response>;

const ROUTES: Record<string, Handler> = {
    // public (join code is the only credential)
    'GET parish': getParishForSignIn,
    'POST session': postSession,
    'DELETE session': deleteSession,

    // public: parish self-onboarding, capped per day (see routes-start.ts)
    'POST parish/start': postParishStart,
    'GET parish/start/health': getParishStartHealth,

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
    'DELETE admin/meeting': deleteMeeting,
    'POST admin/attendance': postAttendance,
    'POST admin/parish': postParish,

    // google, all optional per parish; 503 when the env vars are unset
    'GET google/status': getGoogleStatus,           // public: "does sign-in exist"
    'GET google/signin': getGoogleSignin,           // public: starts OIDC
    'GET google/callback': getGoogleCallback,       // public: both flows return here
    'GET google/connect': getGoogleConnect,         // coordinator
    'POST google/disconnect': postGoogleDisconnect, // coordinator
    'POST google/group': postGoogleGroup,           // coordinator
    'POST google/group/sync': postGoogleGroupSync,  // coordinator
};

// The one route with a path parameter. A regex here beats teaching the whole
// table pattern-matching for a single case.
const SYNC_RSVPS = /^google\/meetings\/([^/]+)\/sync-rsvps$/;

export const onRequest: PagesFunction<Env> = async (context) => {
    const { request, env } = context;
    const url = new URL(request.url);

    const segments = context.params.route;
    const route = Array.isArray(segments) ? segments.join('/') : String(segments ?? '');
    const key = `${request.method} ${route}`;

    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: { Allow: 'GET, POST, DELETE' } });
    }

    const syncMatch = request.method === 'POST' ? SYNC_RSVPS.exec(route) : null;
    const handler = ROUTES[key];
    if (!handler && !syncMatch) return fail(404, `No API route for ${key}.`);

    try {
        const session = await loadSession(request, env);
        const ctx: Ctx = { request, env, url, route, session };
        if (syncMatch) return await postSyncRsvps(ctx, syncMatch[1]); // coordinator
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
