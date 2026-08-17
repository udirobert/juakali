import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

type ReadDb = { db: QueryCtx["db"] };
type WriteDb = { db: MutationCtx["db"] };

// ---------------------------------------------------------------------------
// Venture summary — the shared projection used by listVentures, the cockpit,
// and the briefing index. Lives here (not invest.ts) so both invest.ts and
// this module can use it without an import cycle.
// ---------------------------------------------------------------------------

export const kpiUnitValidator = v.union(v.literal("meetings"), v.literal("revenue_kes"), v.literal("jobs"));

export const ventureSummaryValidator = v.object({
    id: v.id("ventures"),
    name: v.string(),
    craftText: v.string(),
    locationText: v.string(),
    summary: v.string(),
    kpiLabel: v.string(),
    kpiUnit: kpiUnitValidator,
    kpiTarget: v.number(),
    kpiLatest: v.number(),
    kpiTotal: v.number(),
    peerMedian: v.union(v.number(), v.null()),
    agentEmail: v.union(v.string(), v.null()),
    sparkline: v.array(v.number()),
    publicSlug: v.string(),
    status: v.union(v.literal("active"), v.literal("paused"), v.literal("graduated")),
    pledgedKes: v.number(),
});

export async function sumVentureKpis(ctx: ReadDb, ventureId: Id<"ventures">) {
    const checkIns = await ctx.db
        .query("kpiCheckIns")
        .withIndex("by_ventureId", (q) => q.eq("ventureId", ventureId))
        .take(200);
    checkIns.sort((a, b) => b.createdAt - a.createdAt);
    const kpiTotal = checkIns.reduce((sum, row) => sum + row.value, 0);
    const kpiLatest = checkIns.length > 0 ? checkIns[0]!.value : 0;
    return { kpiTotal, kpiLatest, checkIns };
}

export async function pledgedForVenture(ctx: ReadDb, ventureId: Id<"ventures">) {
    const commitments = await ctx.db
        .query("commitments")
        .withIndex("by_ventureId", (q) => q.eq("ventureId", ventureId))
        .take(100);
    return commitments.reduce((sum, row) => sum + row.amountKes, 0);
}

export async function buildVentureSummary(ctx: ReadDb, ventureId: Id<"ventures">) {
    const venture = await ctx.db.get(ventureId);
    if (!venture) return null;
    const { kpiTotal, kpiLatest, checkIns } = await sumVentureKpis(ctx, venture._id);
    const pledgedKes = await pledgedForVenture(ctx, venture._id);
    const sparkline = checkIns
        .slice()
        .reverse()
        .slice(-4)
        .map((row) => row.value);
    return {
        id: venture._id,
        name: venture.name,
        craftText: venture.craftText,
        locationText: venture.locationText,
        summary: venture.summary,
        kpiLabel: venture.kpiLabel,
        kpiUnit: venture.kpiUnit,
        kpiTarget: venture.kpiTarget,
        kpiLatest,
        kpiTotal,
        peerMedian: venture.peerMedian ?? null,
        agentEmail: venture.agentEmail ?? null,
        sparkline,
        publicSlug: venture.publicSlug,
        status: venture.status,
        pledgedKes,
    };
}

// ---------------------------------------------------------------------------
// Denormalized per-investor index
// ---------------------------------------------------------------------------

/**
 * Recompute an investor's denormalized briefing/cockpit index from scratch.
 *
 * The Today briefing, activity feed, and investor cockpit read this single doc
 * (O(1) reads) instead of re-scanning every commitment's runs, digests, emails,
 * and KPI check-ins on every query evaluation. Call this after any run
 * lifecycle transition, commitment change, KPI record, or digest write for
 * that investor.
 *
 * The function is idempotent and recomputes from the source tables, so call
 * sites never need to know the previous state — a missed call simply means the
 * next sync converges. Completed runs carry their own public proof event id
 * (run.pipeline.ledgerEventId), so no per-run ledger lookup is required.
 */
export async function syncInvestorBriefing(ctx: WriteDb, investorId: Id<"investors">) {
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

    // Resolve every referenced venture once: one kpiCheckIns scan serves both
    // the summary and the recent check-ins; one commitments scan serves the
    // pledged total (bounded by the investor's commitments + runs).
    const ventureIds = new Set<string>();
    for (const run of runs) ventureIds.add(String(run.ventureId));
    for (const commitment of commitments) ventureIds.add(String(commitment.ventureId));
    type VentureSummary = Doc<"investorBriefings">["cockpit"][number]["venture"];
    const ventureSummaryByVenture = new Map<string, VentureSummary>();
    const checkInsByVenture = new Map<string, Doc<"kpiCheckIns">[]>();
    for (const raw of ventureIds) {
        const venture = await ctx.db.get(raw as Id<"ventures">);
        if (!venture) continue;
        const { kpiTotal, kpiLatest, checkIns } = await sumVentureKpis(ctx, venture._id);
        const pledgedKes = await pledgedForVenture(ctx, venture._id);
        const sparkline = checkIns
            .slice()
            .reverse()
            .slice(-4)
            .map((row) => row.value);
        ventureSummaryByVenture.set(raw, {
            id: venture._id,
            name: venture.name,
            craftText: venture.craftText,
            locationText: venture.locationText,
            summary: venture.summary,
            kpiLabel: venture.kpiLabel,
            kpiUnit: venture.kpiUnit,
            kpiTarget: venture.kpiTarget,
            kpiLatest,
            kpiTotal,
            peerMedian: venture.peerMedian ?? null,
            agentEmail: venture.agentEmail ?? null,
            sparkline,
            publicSlug: venture.publicSlug,
            status: venture.status,
            pledgedKes,
        });
        checkInsByVenture.set(raw, checkIns);
    }
    const ventureName = (ventureId: Id<"ventures">) =>
        ventureSummaryByVenture.get(String(ventureId))?.name ?? "Venture";

    // Activity buckets (Today + activity feed).
    type Item = Doc<"investorBriefings">["decisions"][number];
    const decisions: Item[] = [];
    const active: Item[] = [];
    const waiting: Item[] = [];
    const failed: Item[] = [];
    const completed: Item[] = [];
    const movedVentureSet = new Set<string>();

    for (const run of runs) {
        const base: Item = {
            id: run._id,
            commitmentId: run.commitmentId,
            ventureName: ventureName(run.ventureId),
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
                title: run.result?.message || run.subject || `${ventureName(run.ventureId)} updated`,
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
        if (!nextScheduled || commitment.nextDigestAt < nextScheduled.at) {
            nextScheduled = {
                label: `Jua checks for responses for ${ventureName(commitment.ventureId)}`,
                at: commitment.nextDigestAt,
            };
        }
    }

    // Cockpit projection: per commitment, the venture summary, latest digest,
    // recent check-ins, recent emails, and newest open proposal.
    type CockpitRow = Doc<"investorBriefings">["cockpit"][number];
    const cockpit: CockpitRow[] = [];
    for (const commitment of commitments) {
        const venture = ventureSummaryByVenture.get(String(commitment.ventureId));
        if (!venture) continue;
        const digests = await ctx.db
            .query("agentDigests")
            .withIndex("by_commitmentId", (q) => q.eq("commitmentId", commitment._id))
            .order("desc")
            .take(1);
        const latest = digests[0];
        const emails = await ctx.db
            .query("agentEmails")
            .withIndex("by_commitmentId", (q) => q.eq("commitmentId", commitment._id))
            .order("desc")
            .take(8);
        emails.sort((a, b) => a.createdAt - b.createdAt);
        const checkIns = checkInsByVenture.get(String(commitment.ventureId)) ?? [];
        // Newest proposed run for this commitment (runs are scanned newest-first).
        const openRun = runs.find(
            (r) => r.commitmentId === commitment._id && r.status === "proposed" && r.actionPlan
        );
        cockpit.push({
            commitmentId: commitment._id,
            venture,
            latestDigest: latest
                ? {
                      id: latest._id,
                      summary: latest.summary,
                      insights: latest.insights,
                      nextAction: latest.nextAction ?? null,
                      evidence: latest.evidence ?? [],
                      createdAt: latest.createdAt,
                  }
                : null,
            recentCheckIns: checkIns.slice(0, 5).map((checkIn) => ({
                id: checkIn._id,
                periodLabel: checkIn.periodLabel,
                metric: checkIn.metric,
                value: checkIn.value,
                note: checkIn.note,
                source: checkIn.source,
                createdAt: checkIn.createdAt,
            })),
            recentEmails: emails.map((email) => ({
                id: email._id,
                direction: email.direction,
                fromAddress: email.fromAddress,
                toAddress: email.toAddress,
                subject: email.subject,
                body: email.body,
                createdAt: email.createdAt,
            })),
            openProposal: openRun
                ? {
                      id: openRun._id,
                      noteBody: openRun.noteBody,
                      subject: openRun.subject,
                      createdAt: openRun.createdAt,
                  }
                : null,
        });
    }

    // Presence: Jua is visibly alive between visits. Proposals alone don't
    // count as "worked"; dismissed runs are ignored entirely.
    let lastWorkedAt: number | null = null;
    let runsThisWeek = 0;
    let openProposals = 0;
    for (const run of runs) {
        if (run.status === "proposed") {
            if (run.actionPlan) openProposals += 1;
            continue;
        }
        if (run.status === "dismissed") continue;
        if (lastWorkedAt === null || run.updatedAt > lastWorkedAt) lastWorkedAt = run.updatedAt;
        if (run.createdAt >= weekAgo) runsThisWeek += 1;
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
        cockpit,
        presence: {
            lastWorkedAt,
            runsThisWeek,
            openProposals,
        },
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

/**
 * Refresh the briefing/cockpit index for every investor with a commitment to a
 * venture (e.g. after a KPI check-in or founder self-report). Handles the
 * multi-investor case by syncing each distinct investor on the venture.
 */
export async function syncInvestorsForVenture(ctx: WriteDb, ventureId: Id<"ventures">) {
    const commitments = await ctx.db
        .query("commitments")
        .withIndex("by_ventureId", (q) => q.eq("ventureId", ventureId))
        .take(100);
    const seen = new Set<string>();
    for (const commitment of commitments) {
        if (seen.has(String(commitment.investorId))) continue;
        seen.add(String(commitment.investorId));
        await syncInvestorBriefing(ctx, commitment.investorId);
    }
}

/**
 * Recompute the global venture browse index (one singleton doc).
 *
 * The cockpit's availableVentures list and the landing browse (listVentures)
 * read this single doc instead of re-scanning every venture plus its KPI
 * check-ins and pledges on each query evaluation. Call this whenever the
 * browse list can change: venture creation, KPI records, or pledge writes
 * (venture status has no mutation path). The list is identical for every
 * investor, so one doc serves all readers.
 *
 * Idempotent like syncInvestorBriefing — recomputes from source tables.
 */
export async function syncVentureBrowse(ctx: WriteDb) {
    const ventures = await ctx.db.query("ventures").order("desc").take(50);
    const summaries: Doc<"ventureBrowse">["ventures"] = [];
    for (const venture of ventures) {
        const summary = await buildVentureSummary(ctx, venture._id);
        if (summary) summaries.push(summary);
    }
    const doc = { ventures: summaries, updatedAt: Date.now() };
    const existing = await ctx.db.query("ventureBrowse").first();
    if (existing) {
        await ctx.db.patch(existing._id, doc);
    } else {
        await ctx.db.insert("ventureBrowse", doc);
    }
}
