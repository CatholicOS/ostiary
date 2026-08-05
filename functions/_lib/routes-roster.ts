// Roster: who is serving which Mass, and the sub-request loop.

import { clean, fail, newId, nowSeconds, ok, readJson, requireUsher } from './http';
import type { Ctx } from './http';

interface SlotRow {
    id: string; starts_at: number; label: string; language: string;
    ushers_needed: number; notes: string | null; unconfirmed_time: number;
}

interface AssignmentRow {
    id: string; slot_id: string; usher_id: string; usher_name: string;
    status: string; sub_reason: string | null;
}

const HORIZON_DAYS = 60;

/** GET /api/roster?days=42
 *  Upcoming slots for the signed-in usher's parish, each with its assignments.
 *  Past slots are excluded: a roster is a forward-looking object. */
export async function getRoster(ctx: Ctx): Promise<Response> {
    const guard = requireUsher(ctx); if (guard) return guard;

    const days = Math.min(Math.max(Number(ctx.url.searchParams.get('days')) || 42, 1), HORIZON_DAYS);
    const from = nowSeconds();
    const to = from + days * 86400;

    const { results: slots } = await ctx.env.DB.prepare(
        `SELECT id, starts_at, label, language, ushers_needed, notes, unconfirmed_time
         FROM mass_slots
         WHERE parish_id = ?1 AND starts_at BETWEEN ?2 AND ?3
         ORDER BY starts_at`,
    ).bind(ctx.session!.p, from, to).all<SlotRow>();

    if (!slots || slots.length === 0) return ok({ slots: [] });

    // One query for every assignment in the window, joined to names, rather
    // than N queries in a loop. D1 charges per statement and a 42-day roster
    // is easily 20 slots.
    const placeholders = slots.map((_, i) => `?${i + 1}`).join(',');
    const { results: assignments } = await ctx.env.DB.prepare(
        `SELECT a.id, a.slot_id, a.usher_id, a.status, a.sub_reason, u.name AS usher_name
         FROM assignments a
         JOIN ushers u ON u.id = a.usher_id
         WHERE a.slot_id IN (${placeholders}) AND a.status != 'dropped'
         ORDER BY u.name`,
    ).bind(...slots.map((s) => s.id)).all<AssignmentRow>();

    const bySlot = new Map<string, AssignmentRow[]>();
    for (const a of assignments ?? []) {
        const list = bySlot.get(a.slot_id) ?? [];
        list.push(a);
        bySlot.set(a.slot_id, list);
    }

    const me = ctx.session!.u;
    return ok({
        slots: slots.map((s) => {
            const list = bySlot.get(s.id) ?? [];
            const mine = list.find((a) => a.usher_id === me) ?? null;
            return {
                ...s,
                unconfirmed_time: s.unconfirmed_time === 1,
                filled: list.length,
                short_by: Math.max(0, s.ushers_needed - list.length),
                assignments: list.map((a) => ({
                    usher_id: a.usher_id, name: a.usher_name,
                    status: a.status, sub_reason: a.sub_reason,
                })),
                my_status: mine?.status ?? null,
            };
        }),
    });
}

async function slotInParish(ctx: Ctx, slotId: string): Promise<SlotRow | null> {
    return ctx.env.DB.prepare(
        `SELECT id, starts_at, label, language, ushers_needed, notes, unconfirmed_time
         FROM mass_slots WHERE id = ?1 AND parish_id = ?2`,
    ).bind(slotId, ctx.session!.p).first<SlotRow>();
}

/** POST /api/roster/signup { slot_id } */
export async function postSignup(ctx: Ctx): Promise<Response> {
    const guard = requireUsher(ctx); if (guard) return guard;

    const body = await readJson<{ slot_id?: string }>(ctx.request);
    const slotId = clean(body?.slot_id, 80);
    if (!slotId) return fail(400, 'slot_id required.');

    const slot = await slotInParish(ctx, slotId);
    if (!slot) return fail(404, 'No such Mass at your parish.');
    if (slot.starts_at < nowSeconds()) return fail(409, 'That Mass has already started.');

    const now = nowSeconds();
    // UNIQUE(slot_id, usher_id) makes this idempotent, and re-signing up after
    // dropping resets the row instead of failing.
    await ctx.env.DB.prepare(
        `INSERT INTO assignments (id, slot_id, usher_id, status, sub_reason, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'assigned', NULL, ?4, ?4)
         ON CONFLICT (slot_id, usher_id)
         DO UPDATE SET status = 'assigned', sub_reason = NULL, updated_at = ?4`,
    ).bind(newId('asn'), slotId, ctx.session!.u, now).run();

    return ok({ slot_id: slotId, status: 'assigned' });
}

/** POST /api/roster/drop { slot_id } */
export async function postDrop(ctx: Ctx): Promise<Response> {
    const guard = requireUsher(ctx); if (guard) return guard;

    const body = await readJson<{ slot_id?: string }>(ctx.request);
    const slotId = clean(body?.slot_id, 80);
    if (!slotId) return fail(400, 'slot_id required.');

    const res = await ctx.env.DB.prepare(
        `UPDATE assignments SET status = 'dropped', updated_at = ?3
         WHERE slot_id = ?1 AND usher_id = ?2`,
    ).bind(slotId, ctx.session!.u, nowSeconds()).run();

    if (!res.meta.changes) return fail(404, 'You are not signed up for that Mass.');
    return ok({ slot_id: slotId, status: 'dropped' });
}

/** POST /api/roster/sub { slot_id, reason }
 *  Keeps the person on the slot but flags that they need covering, so the
 *  coordinator sees a hole that still has a name attached to it rather than a
 *  silent gap. */
export async function postSubRequest(ctx: Ctx): Promise<Response> {
    const guard = requireUsher(ctx); if (guard) return guard;

    const body = await readJson<{ slot_id?: string; reason?: string }>(ctx.request);
    const slotId = clean(body?.slot_id, 80);
    if (!slotId) return fail(400, 'slot_id required.');
    const reason = clean(body?.reason, 300);

    const res = await ctx.env.DB.prepare(
        `UPDATE assignments SET status = 'sub_requested', sub_reason = ?3, updated_at = ?4
         WHERE slot_id = ?1 AND usher_id = ?2 AND status != 'dropped'`,
    ).bind(slotId, ctx.session!.u, reason, nowSeconds()).run();

    if (!res.meta.changes) return fail(404, 'You are not signed up for that Mass.');
    return ok({ slot_id: slotId, status: 'sub_requested' });
}

/** POST /api/roster/cover { slot_id, usher_id }
 *  Take over someone else's sub request. The original assignment is dropped and
 *  the coverer gets their own row, so history reads correctly. */
export async function postCover(ctx: Ctx): Promise<Response> {
    const guard = requireUsher(ctx); if (guard) return guard;

    const body = await readJson<{ slot_id?: string; usher_id?: string }>(ctx.request);
    const slotId = clean(body?.slot_id, 80);
    const forUsher = clean(body?.usher_id, 80);
    if (!slotId || !forUsher) return fail(400, 'slot_id and usher_id required.');
    if (forUsher === ctx.session!.u) return fail(400, 'You cannot cover for yourself.');

    const slot = await slotInParish(ctx, slotId);
    if (!slot) return fail(404, 'No such Mass at your parish.');

    const now = nowSeconds();
    await ctx.env.DB.batch([
        ctx.env.DB.prepare(
            `UPDATE assignments SET status = 'dropped', updated_at = ?3
             WHERE slot_id = ?1 AND usher_id = ?2 AND status = 'sub_requested'`,
        ).bind(slotId, forUsher, now),
        ctx.env.DB.prepare(
            `INSERT INTO assignments (id, slot_id, usher_id, status, sub_reason, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'confirmed', NULL, ?4, ?4)
             ON CONFLICT (slot_id, usher_id)
             DO UPDATE SET status = 'confirmed', sub_reason = NULL, updated_at = ?4`,
        ).bind(newId('asn'), slotId, ctx.session!.u, now),
    ]);

    return ok({ slot_id: slotId, status: 'confirmed' });
}
