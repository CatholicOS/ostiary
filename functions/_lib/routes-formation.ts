// Formation: serve the curriculum, record progress, report team status.

import { CURRICULUM, moduleBySlug } from './curriculum';
import { clean, fail, newId, nowSeconds, ok, readJson, requireAdmin, requireUsher } from './http';
import type { Ctx } from './http';

interface ProgressRow {
    module_slug: string; completed_at: number; score: number | null; score_max: number | null;
}

/** GET /api/formation
 *  Modules plus this usher's progress. Answers are stripped: the client never
 *  receives the key for a self-check it has not submitted, which keeps the
 *  check honest without needing a second round trip per question. */
export async function getFormation(ctx: Ctx): Promise<Response> {
    const guard = requireUsher(ctx); if (guard) return guard;

    const { results } = await ctx.env.DB.prepare(
        `SELECT module_slug, completed_at, score, score_max
         FROM formation_progress WHERE usher_id = ?1`,
    ).bind(ctx.session!.u).all<ProgressRow>();

    const done = new Map((results ?? []).map((r) => [r.module_slug, r]));

    const parish = await ctx.env.DB.prepare(
        `SELECT policy_notes FROM parishes WHERE id = ?1`,
    ).bind(ctx.session!.p).first<{ policy_notes: string | null }>();

    return ok({
        policy_notes: parish?.policy_notes ?? null,
        modules: CURRICULUM.map((m) => ({
            slug: m.slug,
            ord: m.ord,
            title: m.title,
            minutes: m.minutes,
            summary: m.summary,
            policy_gap: m.policyGap === true,
            sections: m.sections,
            check: m.check.map((c) => ({ q: c.q, options: c.options })),
            progress: done.get(m.slug) ?? null,
        })),
    });
}

/** POST /api/formation/complete { module_slug, answers: number[] }
 *  Grades server-side and returns which ones were wrong, with the reason. A
 *  wrong answer does not block completion: this is formation, not a gate. The
 *  score is recorded so a coordinator can see who needs a conversation. */
export async function postFormationComplete(ctx: Ctx): Promise<Response> {
    const guard = requireUsher(ctx); if (guard) return guard;

    const body = await readJson<{ module_slug?: string; answers?: number[] }>(ctx.request);
    const slug = clean(body?.module_slug, 60);
    if (!slug) return fail(400, 'module_slug required.');

    const mod = moduleBySlug(slug);
    if (!mod) return fail(404, 'No such module.');

    const answers = Array.isArray(body?.answers) ? body!.answers! : [];
    const feedback = mod.check.map((c, i) => ({
        q: c.q,
        correct: answers[i] === c.answer,
        answer: c.answer,
        why: c.why,
    }));
    const score = feedback.filter((f) => f.correct).length;

    const now = nowSeconds();
    await ctx.env.DB.prepare(
        `INSERT INTO formation_progress (id, usher_id, module_slug, completed_at, score, score_max)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT (usher_id, module_slug)
         DO UPDATE SET completed_at = ?4, score = ?5, score_max = ?6`,
    ).bind(newId('prg'), ctx.session!.u, slug, now, score, mod.check.length).run();

    return ok({ module_slug: slug, score, score_max: mod.check.length, feedback });
}

/** GET /api/formation/status  (coordinator only)
 *  The grid a coordinator actually needs: who has finished what. */
export async function getFormationStatus(ctx: Ctx): Promise<Response> {
    const guard = requireAdmin(ctx); if (guard) return guard;

    const { results } = await ctx.env.DB.prepare(
        `SELECT u.id, u.name, u.role, p.module_slug, p.completed_at, p.score, p.score_max
         FROM ushers u
         LEFT JOIN formation_progress p ON p.usher_id = u.id
         WHERE u.parish_id = ?1 AND u.active = 1
         ORDER BY u.name`,
    ).bind(ctx.session!.p).all<{
        id: string; name: string; role: string;
        module_slug: string | null; completed_at: number | null;
        score: number | null; score_max: number | null;
    }>();

    const byUsher = new Map<string, {
        id: string; name: string; role: string;
        completed: Record<string, { at: number; score: number | null; score_max: number | null }>;
    }>();

    for (const row of results ?? []) {
        const entry = byUsher.get(row.id) ?? { id: row.id, name: row.name, role: row.role, completed: {} };
        if (row.module_slug && row.completed_at) {
            entry.completed[row.module_slug] = {
                at: row.completed_at, score: row.score, score_max: row.score_max,
            };
        }
        byUsher.set(row.id, entry);
    }

    const total = CURRICULUM.length;
    return ok({
        modules: CURRICULUM.map((m) => ({ slug: m.slug, title: m.title, ord: m.ord })),
        ushers: [...byUsher.values()].map((u) => ({
            ...u,
            done: Object.keys(u.completed).length,
            total,
        })),
    });
}
