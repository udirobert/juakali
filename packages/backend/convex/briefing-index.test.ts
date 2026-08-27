/**
 * Regression tests for the denormalized investorBriefings index.
 *
 * Guards that the Today briefing and activity feeds read from the index (no
 * per-commitment run scans / per-run ledger lookups on the query path) and
 * that the index stays in sync across every run lifecycle transition:
 *   - proposed → decisions bucket
 *   - approve → waiting (request step)
 *   - evidence → awaiting_publication decision (second approval)
 *   - publish → completed with its public proof event id
 *   - stale sweep → failed bucket + blocked stat
 * and that the legacy scan fallback still renders correctly for investors
 * whose index hasn't been built yet.
 */
import { convexTest } from "convex-test";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import type { Id } from "./_generated/dataModel";

function initTest() {
    const t = convexTest(schema, import.meta.glob("./**/*.*s"));
    rateLimiterTest.register(t);
    return t;
}

async function createInvestor(t: ReturnType<typeof initTest>, email: string) {
    const userId = await t.run(async (ctx) => {
        return await ctx.db.insert("users", {
            email,
            name: email.split("@")[0],
            emailVerificationTime: Date.now(),
        });
    });
    const investorId = await t.run(async (ctx) => {
        return await ctx.db.insert("investors", {
            displayName: email.split("@")[0],
            email,
            phone: null,
            userId,
            isDefaultDemo: false,
            createdAt: Date.now(),
        });
    });
    const asUser = t.withIdentity({
        subject: `${userId}|test-session`,
        issuer: "https://test.convex.dev",
        tokenIdentifier: `https://test.convex.dev|${userId}|test-session`,
    });
    return { userId, investorId, asUser };
}

async function createVentureWithCommitment(
    t: ReturnType<typeof initTest>,
    investorId: Id<"investors">,
    opts: { kpiUnit?: "meetings" | "revenue_kes" | "jobs" } = {}
) {
    return await t.run(async (ctx) => {
        const ventureId = await ctx.db.insert("ventures", {
            name: "Test Venture",
            craftText: "Welding",
            craftKey: "welding",
            locationText: "Nairobi",
            locationKey: "nairobi",
            summary: "A test venture.",
            kpiLabel: "Jobs completed",
            kpiUnit: opts.kpiUnit ?? "jobs",
            kpiTarget: 10,
            agentEmail: "test@agent.juakali.demo",
            publicSlug: "test-venture",
            status: "active",
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
        const commitmentId = await ctx.db.insert("commitments", {
            investorId,
            ventureId,
            amountKes: 10000,
            shareBps: 1000,
            capMultiple: 2,
            status: "active",
            thesis: "Test thesis.",
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
        return { ventureId, commitmentId };
    });
}

async function seedProposal(
    t: ReturnType<typeof initTest>,
    commitmentId: Id<"commitments">,
    ventureId: Id<"ventures">
) {
    return await t.run(async (ctx) => {
        const commitment = await ctx.db.get(commitmentId);
        const venture = await ctx.db.get(ventureId);
        if (!commitment || !venture) throw new Error("missing docs");
        const { createProposalForCommitment } = await import("./agentRuns");
        return await createProposalForCommitment(ctx, commitment, venture, 3, null, "ask_every_time");
    });
}

async function getBriefing(t: ReturnType<typeof initTest>, investorId: Id<"investors">) {
    return await t.run(async (ctx) => {
        return await ctx.db
            .query("investorBriefings")
            .withIndex("by_investorId", (q) => q.eq("investorId", investorId))
            .first();
    });
}

async function drain(t: ReturnType<typeof initTest>) {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
}

beforeEach(() => {
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
});

describe("investor briefing index", () => {
    test("a new proposal syncs into the decisions bucket", async () => {
        const t = initTest();
        const { investorId } = await createInvestor(t, "alice@test.com");
        const { ventureId, commitmentId } = await createVentureWithCommitment(t, investorId);
        const proposalId = await seedProposal(t, commitmentId, ventureId);

        const briefing = await getBriefing(t, investorId);
        expect(briefing).not.toBeNull();
        expect(briefing!.decisions).toHaveLength(1);
        expect(briefing!.decisions[0]!.id).toBe(proposalId);
        expect(briefing!.decisions[0]!.status).toBe("proposed");
        expect(briefing!.decisions[0]!.ventureName).toBe("Test Venture");
        expect(briefing!.blockedCount).toBe(0);
        expect(briefing!.movedVentureIds).toHaveLength(0);
    });

    test("todayBriefing serves the decision from the index with the persisted plan", async () => {
        const t = initTest();
        const { investorId, asUser } = await createInvestor(t, "alice@test.com");
        const { ventureId, commitmentId } = await createVentureWithCommitment(t, investorId);
        const proposalId = await seedProposal(t, commitmentId, ventureId);

        const briefing = await asUser.query(api.invest.todayBriefing, {});
        expect(briefing.decision).not.toBeNull();
        expect(briefing.decision!.id).toBe(proposalId);
        expect(briefing.decision!.ventureName).toBe("Test Venture");
        expect(briefing.stats.needsDecision).toBe(1);
        expect(briefing.stats.blocked).toBe(0);

        // The indexed view is the persisted contract, identical to the
        // standalone approval detail (single representation of the contract).
        const detail = await asUser.query(api.agentRuns.getProposalDetail, { runId: proposalId });
        expect(detail!.reason.whyNow).toBe(briefing.decision!.reason.whyNow);
        expect(detail!.preview.publicSummary).toBe(briefing.decision!.preview.publicSummary);
    });

    test("scan fallback renders before the index exists (commitment without runs)", async () => {
        const t = initTest();
        const { investorId, asUser } = await createInvestor(t, "alice@test.com");
        // Create a commitment directly (no mutation → no sync → no index doc).
        await t.run(async (ctx) => {
            const ventureId = await ctx.db.insert("ventures", {
                name: "Direct Venture",
                craftText: "Sales",
                craftKey: "sales",
                locationText: "Nairobi",
                locationKey: "nairobi",
                summary: "Direct insert.",
                kpiLabel: "Meetings booked",
                kpiUnit: "meetings",
                kpiTarget: 10,
                publicSlug: "direct-venture",
                status: "active",
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });
            await ctx.db.insert("commitments", {
                investorId,
                ventureId,
                amountKes: 5000,
                shareBps: 1000,
                capMultiple: 2,
                status: "active",
                thesis: "Direct insert.",
                nextDigestAt: 123456789,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });
        });

        const briefing = await asUser.query(api.invest.todayBriefing, {});
        // No runs → no decision, but the commitment's next digest is surfaced.
        expect(briefing.stats.needsDecision).toBe(0);
        expect(briefing.nextScheduled).not.toBeNull();
        expect(briefing.nextScheduled!.at).toBe(123456789);

        // No index doc exists yet — the query used the scan fallback.
        const doc = await getBriefing(t, investorId);
        expect(doc).toBeNull();
    });

    test("scan fallback renders a decision when the index is absent", async () => {
        const t = initTest();
        const { investorId, asUser } = await createInvestor(t, "alice@test.com");
        const { ventureId, commitmentId } = await createVentureWithCommitment(t, investorId);

        // Insert a proposed run directly, bypassing the syncing helper, so the
        // index doc is absent and the query must use the scan fallback.
        const proposalId = await t.run(async (ctx) => {
            const venture = await ctx.db.get(ventureId);
            const commitment = await ctx.db.get(commitmentId);
            if (!venture || !commitment) throw new Error("missing docs");
            const { buildProactiveActionPlan } = await import("./actionPlan");
            const actionPlan = buildProactiveActionPlan({
                ventureName: venture.name,
                daysStale: 3,
                metricLabel: venture.kpiLabel || "KPI",
                lastCheckInAt: null,
                autonomyLevel: "ask_every_time",
            });
            return await ctx.db.insert("agentRuns", {
                commitmentId,
                ventureId,
                investorId,
                status: "proposed",
                trigger: "proactive",
                noteBody: "Check-in request",
                subject: `Check-in: ${venture.name}`,
                metricOverride: null,
                valueOverride: null,
                fromAddress: "jua@agent.juakali.demo",
                toAddress: venture.agentEmail ?? "agent@juakali.demo",
                source: "agent",
                steps: [],
                actionPlan,
                correlationId: `proposal_${Date.now()}_${commitmentId}`,
                result: null,
                error: null,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });
        });

        const briefing = await asUser.query(api.invest.todayBriefing, {});
        expect(briefing.decision).not.toBeNull();
        expect(briefing.decision!.id).toBe(proposalId);
        expect(briefing.stats.needsDecision).toBe(1);
    });

    test("two-step flow moves the run through decisions into completed with proof", async () => {
        const t = initTest();
        const { investorId, asUser } = await createInvestor(t, "alice@test.com");
        const { ventureId, commitmentId } = await createVentureWithCommitment(t, investorId);
        const proposalId = await seedProposal(t, commitmentId, ventureId);

        // Approve the request → request sent, run parks waiting on the founder.
        await asUser.mutation(api.agentRuns.approveProposal, { runId: proposalId });
        await drain(t);
        let briefing = await getBriefing(t, investorId);
        expect(briefing!.decisions).toHaveLength(0);
        expect(briefing!.waiting).toHaveLength(1);
        expect(briefing!.waiting[0]!.id).toBe(proposalId);

        // Evidence arrives → awaiting_publication decision (second approval).
        await asUser.mutation(api.agentRuns.submitFounderEvidence, {
            runId: proposalId,
            value: 4,
        });
        await drain(t);
        briefing = await getBriefing(t, investorId);
        expect(briefing!.decisions).toHaveLength(1);
        expect(briefing!.decisions[0]!.status).toBe("awaiting_publication");

        // Approve publication → run completes; index carries the public proof.
        await asUser.mutation(api.agentRuns.publishApproval, { runId: proposalId });
        await drain(t);
        briefing = await getBriefing(t, investorId);
        expect(briefing!.decisions).toHaveLength(0);
        expect(briefing!.waiting).toHaveLength(0);
        expect(briefing!.completed).toHaveLength(1);
        expect(briefing!.completed[0]!.id).toBe(proposalId);
        expect(briefing!.completed[0]!.proofEventId).not.toBeNull();
        expect(briefing!.movedVentureIds).toContain(ventureId);

        // The activity feed reads the same index.
        const activity = await asUser.query(api.agentRuns.activityForInvestor, {});
        expect(activity.completed).toHaveLength(1);
        expect(activity.completed[0]!.id).toBe(proposalId);

        // Today surfaces the completed item with a live proof link.
        const briefingView = await asUser.query(api.invest.todayBriefing, {});
        expect(briefingView.completed).toHaveLength(1);
        expect(briefingView.completed[0]!.runId).toBe(proposalId);
        expect(briefingView.completed[0]!.proofEventId).toBe(
            briefing!.completed[0]!.proofEventId
        );
        expect(briefingView.stats.venturesMoved).toBe(1);
        expect(briefingView.stats.needsDecision).toBe(0);
    });

    test("stale runs recovered by the sweep land in the failed bucket", async () => {
        const t = initTest();
        const { investorId, asUser } = await createInvestor(t, "alice@test.com");
        const { commitmentId } = await createVentureWithCommitment(t, investorId);

        // An evidence-backed run starts executing (step 1 scheduled, not run yet).
        const { runId } = await asUser.mutation(api.agentRuns.startAgentRun, {
            commitmentId,
            noteBody: "Push follow-ups",
            metric: "jobs_completed",
            value: 2,
        });
        // Backdate so it looks stuck past the cutoff, then run the sweep.
        await t.run(async (ctx) => {
            await ctx.db.patch(runId, { updatedAt: Date.now() - 10 * 60 * 1000 });
        });
        await t.mutation(internal.agentRuns.recoverStaleRuns, { olderThanMs: 60_000 });
        await drain(t);

        const briefing = await getBriefing(t, investorId);
        expect(briefing!.failed).toHaveLength(1);
        expect(briefing!.failed[0]!.id).toBe(runId);
        expect(briefing!.blockedCount).toBe(1);

        const briefingView = await asUser.query(api.invest.todayBriefing, {});
        expect(briefingView.stats.blocked).toBe(1);

        const activity = await asUser.query(api.agentRuns.activityForInvestor, {});
        expect(activity.failed).toHaveLength(1);
        expect(activity.failed[0]!.id).toBe(runId);
    });

    test("pre-cockpit index docs (no cockpit/presence) stay readable", async () => {
        const t = initTest();
        const { investorId, asUser } = await createInvestor(t, "legacy@test.com");

        // The doc shape written before the cockpit projection existed: activity
        // buckets only, no cockpit/presence. Reading it must not throw a schema
        // validation error — todayBriefing/activityForInvestor don't need those
        // fields, and investorCockpit degrades to its scan fallback.
        await t.run(async (ctx) => {
            await ctx.db.insert("investorBriefings", {
                investorId,
                decisions: [],
                active: [],
                waiting: [],
                failed: [],
                completed: [],
                movedVentureIds: [],
                blockedCount: 0,
                nextScheduled: null,
                updatedAt: Date.now(),
            });
        });

        const briefing = await asUser.query(api.invest.todayBriefing, {});
        expect(briefing.stats).toEqual({ needsDecision: 0, venturesMoved: 0, blocked: 0 });

        const activity = await asUser.query(api.agentRuns.activityForInvestor, {});
        expect(activity.active).toEqual([]);
    });
});
