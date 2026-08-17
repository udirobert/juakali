import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

type DbCtx = { db: MutationCtx["db"] };

/**
 * Recompute an investor's denormalized briefing index from scratch.
 *
 * The Today briefing and activity feeds read this single doc (O(1) reads)
 * instead of re-scanning every commitment's runs and per-run ledger events on
 * every query evaluation. Call this after any run lifecycle transition or
 * commitment change for that investor.
 *
 * The function is idempotent and recomputes from the source tables, so call
 * sites never need to know the previous state — a missed call simply means the
 * next sync converges. Completed runs carry their own public proof event id
 * (run.pipeline.ledgerEventId), so no per-run ledger lookup is required.
 */
export async function syncInvestorBriefing(ctx: DbCtx, investorId: Id<"investors">) {
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

    const runs = await ctx.db
        .query("agentRuns")
        .withIndex("by_investorId", (q) => q.eq("investorId", investorId))
        .order("desc")
        .take(80);
    const commitments = await ctx.db
        .query("commitments")
        .withIndex("by_investorId", (q) => q.eq("investorId", investorId))
        .order("desc")
        .take(30);

    // Resolve venture names for every referenced venture (bounded by the scans
    // above — an investor's ventures are at most their commitments + runs).
    const ventureIds = new Set<string>();
    for (const run of runs) ventureIds.add(String(run.ventureId));
    for (const commitment of commitments) ventureIds.add(String(commitment.ventureId));
    const ventureNames = new Map<string, string>();
    for (const raw of ventureIds) {
        const venture = await ctx.db.get(raw as Id<"ventures">);
        if (venture) ventureNames.set(raw, venture.name);
    }

    type Item = Doc<"investorBriefings">["decisions"][number];
    const decisions: Item[] = [];
    const active: Item[] = [];
    const waiting: Item[] = [];
    const failed: Item[] = [];
    const completed: Item[] = [];
    const movedVentureSet = new Set<string>();

    for (const run of runs) {
        const ventureName = ventureNames.get(String(run.ventureId)) ?? "Venture";
        const base: Item = {
            id: run._id,
            commitmentId: run.commitmentId,
            ventureName,
            status: run.status,
            trigger: run.trigger,
            subject: run.subject,
            error: run.error ?? null,
            updatedAt: run.updatedAt,
        };
        if (run.status === "proposed" || run.status === "awaiting_publication") {
            decisions.push({ ...base, createdAt: run.createdAt });
        } else if (run.status === "running") {
            active.push(base);
        } else if (run.status === "waiting_for_response") {
            waiting.push(base);
        } else if (run.status === "failed") {
            failed.push(base);
        } else if (run.status === "completed" && run.updatedAt >= weekAgo) {
            completed.push({
                ...base,
                title: run.result?.message || run.subject || `${ventureName} updated`,
                // The run's own pipeline records its public proof event — no
                // per-run ledger lookup needed.
                proofEventId: run.pipeline?.ledgerEventId ?? null,
            });
            movedVentureSet.add(String(run.ventureId));
        }
    }

    // Oldest decision first — Today surfaces the oldest open decision.
    decisions.sort((a, b) => (a.createdAt ?? a.updatedAt) - (b.createdAt ?? b.updatedAt));
    // Newest activity first.
    active.sort((a, b) => b.updatedAt - a.updatedAt);
    waiting.sort((a, b) => b.updatedAt - a.updatedAt);
    failed.sort((a, b) => b.updatedAt - a.updatedAt);
    completed.sort((a, b) => b.updatedAt - a.updatedAt);

    // Earliest next digest across the investor's commitments.
    let nextScheduled: { label: string; at: number } | null = null;
    for (const commitment of commitments) {
        if (commitment.nextDigestAt == null) continue;
        const name = ventureNames.get(String(commitment.ventureId)) ?? "Venture";
        if (!nextScheduled || commitment.nextDigestAt < nextScheduled.at) {
            nextScheduled = {
                label: `Jua checks for responses for ${name}`,
                at: commitment.nextDigestAt,
            };
        }
    }

    const doc = {
        investorId,
        decisions: decisions.slice(0, 30),
        active: active.slice(0, 30),
        waiting: waiting.slice(0, 30),
        failed: failed.slice(0, 30),
        completed: completed.slice(0, 30),
        movedVentureIds: Array.from(movedVentureSet) as Id<"ventures">[],
        blockedCount: failed.length,
        nextScheduled,
        updatedAt: now,
    };

    const existing = await ctx.db
        .query("investorBriefings")
        .withIndex("by_investorId", (q) => q.eq("investorId", investorId))
        .first();
    if (existing) {
        await ctx.db.patch(existing._id, doc);
    } else {
        await ctx.db.insert("investorBriefings", doc);
    }
}
