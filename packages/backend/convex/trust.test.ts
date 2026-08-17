/**
 * Trust-critical regression tests.
 *
 * These guard the release blockers:
 *   1. Proactive follow-up cannot record KPI data before founder evidence.
 *   2. Anonymous users cannot retrieve private proof events or chain members.
 *   3. Published ledger text equals the approved public preview.
 *   4. Retry cannot duplicate previously committed effects.
 *   5. Retry retains the approved action plan and correlation lineage.
 *   6. auto_low_risk only automates the private request (no public effect).
 *   7. Standalone and inline approvals render the same persisted contract.
 *   8. Founder mutations enforce ownership.
 */
import { convexTest } from "convex-test";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import type { Id } from "./_generated/dataModel";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function initTest() {
    const t = convexTest(schema, import.meta.glob("./**/*.*s"));
    rateLimiterTest.register(t);
    return t;
}

/** Create a user + linked investor; returns an authenticated accessor. */
async function createInvestor(
    t: ReturnType<typeof initTest>,
    email: string,
    opts: { autonomyLevel?: "ask_every_time" | "auto_low_risk" | "pause_all" } = {}
) {
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
            autonomyLevel: opts.autonomyLevel,
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

/** Create a venture + commitment for an investor. */
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

/** Seed a proactive proposal for a commitment (as the cron would). */
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

/** Drain all scheduled functions (the step pipeline).
 *
 * Fake timers must already be active (they are, via beforeEach) so that the
 * `runAfter(0, ...)` calls made by mutations don't fire on real timers outside
 * a convex-test transaction.
 */
async function drain(t: ReturnType<typeof initTest>) {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
}

beforeEach(() => {
    // Activate fake timers BEFORE any mutation schedules work, so scheduled
    // functions only run inside finishAllScheduledFunctions transactions.
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// 1. Proactive follow-up cannot record KPI before founder evidence
// ---------------------------------------------------------------------------
describe("proactive approval does not manufacture KPI evidence", () => {
    test("approving a proactive proposal sends a request and parks — no KPI recorded", async () => {
        const t = initTest();
        const { investorId, asUser } = await createInvestor(t, "alice@test.com");
        const { ventureId, commitmentId } = await createVentureWithCommitment(t, investorId);
        const proposalId = await seedProposal(t, commitmentId, ventureId);

        await asUser.mutation(api.agentRuns.approveProposal, { runId: proposalId });
        await drain(t);

        const state = await t.run(async (ctx) => {
            const run = await ctx.db.get(proposalId);
            const checkIns = await ctx.db
                .query("kpiCheckIns")
                .withIndex("by_ventureId", (q) => q.eq("ventureId", ventureId))
                .collect();
            const publicEvents = await ctx.db
                .query("ledgerEvents")
                .withIndex("by_publicVisible_and_createdAt", (q) => q.eq("publicVisible", true))
                .collect();
            return { run, checkIns, publicEvents };
        });

        // The run parks waiting for the founder — it never records a KPI.
        expect(state.run?.status).toBe("waiting_for_response");
        expect(state.checkIns).toHaveLength(0);
        // No public ledger event was published by the request step.
        expect(state.publicEvents).toHaveLength(0);
    });

    test("KPI is recorded only after the second (publication) approval", async () => {
        const t = initTest();
        const { investorId, asUser } = await createInvestor(t, "alice@test.com");
        const { ventureId, commitmentId } = await createVentureWithCommitment(t, investorId);
        const proposalId = await seedProposal(t, commitmentId, ventureId);

        await asUser.mutation(api.agentRuns.approveProposal, { runId: proposalId });
        await drain(t);

        // Founder responds with real evidence.
        await asUser.mutation(api.agentRuns.submitFounderEvidence, {
            runId: proposalId,
            value: 4,
            note: "Completed 4 gate jobs this week",
        });
        await drain(t);

        // Evidence parks the run — nothing recorded or published yet.
        let state = await t.run(async (ctx) => {
            const run = await ctx.db.get(proposalId);
            const checkIns = await ctx.db
                .query("kpiCheckIns")
                .withIndex("by_ventureId", (q) => q.eq("ventureId", ventureId))
                .collect();
            const publicEvents = await ctx.db
                .query("ledgerEvents")
                .withIndex("by_publicVisible_and_createdAt", (q) => q.eq("publicVisible", true))
                .collect();
            return { run, checkIns, publicEvents };
        });
        expect(state.run?.status).toBe("awaiting_publication");
        expect(state.checkIns).toHaveLength(0);
        expect(state.publicEvents).toHaveLength(0);

        // Second approval — approve the exact KPI + public summary.
        const approvedText = "Jua confirmed 4 completed jobs with the founder for Test Venture.";
        await asUser.mutation(api.agentRuns.publishApproval, {
            runId: proposalId,
            publicSummary: approvedText,
        });
        await drain(t);

        state = await t.run(async (ctx) => {
            const run = await ctx.db.get(proposalId);
            const checkIns = await ctx.db
                .query("kpiCheckIns")
                .withIndex("by_ventureId", (q) => q.eq("ventureId", ventureId))
                .collect();
            const publicEvents = await ctx.db
                .query("ledgerEvents")
                .withIndex("by_publicVisible_and_createdAt", (q) => q.eq("publicVisible", true))
                .collect();
            return { run, checkIns, publicEvents };
        });

        expect(state.run?.status).toBe("completed");
        expect(state.checkIns).toHaveLength(1);
        expect(state.checkIns[0]?.value).toBe(4);
        // Transport source stays "agent"; provenance is tracked separately and
        // must not be collapsed into "self" (which would imply founder proof).
        expect(state.checkIns[0]?.source).toBe("agent");
        expect(state.checkIns[0]?.evidenceSource).toBe("investor_entered");
        expect(state.run?.evidenceSource).toBe("investor_entered");
        // The exact approved summary is what got published.
        const actionEvent = state.publicEvents.find((e) => e.type === "action");
        expect(actionEvent?.summary).toBe(approvedText);
    });

    test("submitFounderEvidence rejects non-positive values", async () => {
        const t = initTest();
        const { investorId, asUser } = await createInvestor(t, "alice@test.com");
        const { ventureId, commitmentId } = await createVentureWithCommitment(t, investorId);
        const proposalId = await seedProposal(t, commitmentId, ventureId);

        await asUser.mutation(api.agentRuns.approveProposal, { runId: proposalId });
        await drain(t);

        await expect(
            asUser.mutation(api.agentRuns.submitFounderEvidence, { runId: proposalId, value: 0 })
        ).rejects.toThrow(/positive/i);
        await expect(
            asUser.mutation(api.agentRuns.submitFounderEvidence, { runId: proposalId, value: -3 })
        ).rejects.toThrow(/positive/i);
    });
});

// ---------------------------------------------------------------------------
// 2. Anonymous users cannot retrieve private proof events
// ---------------------------------------------------------------------------
describe("proofEvent is fail-closed for private events", () => {
    test("anonymous caller gets null for a private root event", async () => {
        const t = initTest();
        const { investorId } = await createInvestor(t, "alice@test.com");
        const { ventureId, commitmentId } = await createVentureWithCommitment(t, investorId);

        // Directly create a private ledger event for a clean assertion.
        const privateEventId = await t.run(async (ctx) => {
            return await ctx.db.insert("ledgerEvents", {
                type: "action",
                ventureId,
                commitmentId,
                summary: "Private request",
                createdAt: Date.now(),
                publicVisible: false,
                correlationId: "corr_1",
                initiator: "jua",
            });
        });

        // Anonymous (no identity) must not see it.
        const anon = await t.query(api.invest.proofEvent, { eventId: privateEventId });
        expect(anon).toBeNull();
    });

    test("anonymous caller sees a public event but private chain members are filtered", async () => {
        const t = initTest();
        const { investorId } = await createInvestor(t, "alice@test.com");
        const { ventureId, commitmentId } = await createVentureWithCommitment(t, investorId);

        const { publicEventId } = await t.run(async (ctx) => {
            const publicEventId = await ctx.db.insert("ledgerEvents", {
                type: "action",
                ventureId,
                commitmentId,
                summary: "Public action",
                createdAt: Date.now(),
                publicVisible: true,
                correlationId: "corr_2",
                initiator: "jua",
            });
            await ctx.db.insert("ledgerEvents", {
                type: "action",
                ventureId,
                commitmentId,
                summary: "Private sibling",
                createdAt: Date.now() + 1,
                publicVisible: false,
                correlationId: "corr_2",
                initiator: "jua",
            });
            return { publicEventId };
        });

        const result = await t.query(api.invest.proofEvent, { eventId: publicEventId });
        expect(result).not.toBeNull();
        // The private sibling must be filtered out of the chain.
        expect(result!.chain.every((c) => c.publicVisible)).toBe(true);
        expect(result!.chain.map((c) => c.summary)).not.toContain("Private sibling");
    });

    test("owning investor can see their private event", async () => {
        const t = initTest();
        const { investorId, asUser } = await createInvestor(t, "alice@test.com");
        const { ventureId, commitmentId } = await createVentureWithCommitment(t, investorId);

        const privateEventId = await t.run(async (ctx) => {
            return await ctx.db.insert("ledgerEvents", {
                type: "action",
                ventureId,
                commitmentId,
                summary: "Private request",
                createdAt: Date.now(),
                publicVisible: false,
                correlationId: "corr_3",
                initiator: "jua",
            });
        });

        const result = await asUser.query(api.invest.proofEvent, { eventId: privateEventId });
        expect(result).not.toBeNull();
        expect(result!.summary).toBe("Private request");
    });

    test("non-owning authenticated investor cannot see a private event", async () => {
        const t = initTest();
        const { investorId } = await createInvestor(t, "alice@test.com");
        const { ventureId, commitmentId } = await createVentureWithCommitment(t, investorId);

        const privateEventId = await t.run(async (ctx) => {
            return await ctx.db.insert("ledgerEvents", {
                type: "action",
                ventureId,
                commitmentId,
                summary: "Private request",
                createdAt: Date.now(),
                publicVisible: false,
                correlationId: "corr_4",
                initiator: "jua",
            });
        });

        const { asUser: asBob } = await createInvestor(t, "bob@test.com");
        const result = await asBob.query(api.invest.proofEvent, { eventId: privateEventId });
        expect(result).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// 3. Published ledger text equals the approved public preview
// ---------------------------------------------------------------------------
describe("approved publicSummary is published verbatim", () => {
    test("stepPostLedger publishes the exact approved summary", async () => {
        const t = initTest();
        const { investorId, asUser } = await createInvestor(t, "alice@test.com");
        const { ventureId, commitmentId } = await createVentureWithCommitment(t, investorId);
        const proposalId = await seedProposal(t, commitmentId, ventureId);

        const approvedText = "Jua confirmed 4 completed jobs with the founder for Test Venture.";

        await asUser.mutation(api.agentRuns.approveProposal, {
            runId: proposalId,
            publicSummary: approvedText,
        });
        await drain(t);

        // Submit evidence, then approve publication so the pipeline reaches
        // the ledger step with the exact approved summary.
        await asUser.mutation(api.agentRuns.submitFounderEvidence, {
            runId: proposalId,
            value: 4,
        });
        await drain(t);
        await asUser.mutation(api.agentRuns.publishApproval, {
            runId: proposalId,
            publicSummary: approvedText,
        });
        await drain(t);

        const publicActions = await t.run(async (ctx) => {
            return await ctx.db
                .query("ledgerEvents")
                .withIndex("by_publicVisible_and_createdAt", (q) => q.eq("publicVisible", true))
                .collect();
        });

        const actionEvent = publicActions.find((e) => e.type === "action");
        expect(actionEvent).toBeDefined();
        expect(actionEvent!.summary).toBe(approvedText);
    });
});

// ---------------------------------------------------------------------------
// 4 & 5. Retry is idempotent and preserves plan + lineage
// ---------------------------------------------------------------------------
describe("retry is idempotent and preserves the approved contract", () => {
    test("retry after a committed KPI does not duplicate the check-in", async () => {
        const t = initTest();
        const { investorId, asUser } = await createInvestor(t, "alice@test.com");
        const { ventureId, commitmentId } = await createVentureWithCommitment(t, investorId);

        // An evidence-backed run (approved_note path) records a KPI.
        const { runId } = await asUser.mutation(api.agentRuns.startAgentRun, {
            commitmentId,
            noteBody: "Push follow-ups",
            metric: "jobs_completed",
            value: 2,
        });
        await drain(t);

        // Force-fail the run after the KPI step committed (simulate a crash in
        // the digest step) by patching status directly.
        await t.run(async (ctx) => {
            const run = await ctx.db.get(runId);
            if (!run) throw new Error("run missing");
            const steps = run.steps.map((s) =>
                s.tool === "create_investor_digest"
                    ? { ...s, status: "failed" as const, detail: "boom" }
                    : s.tool === "post_public_ledger" || s.tool === "send_reply"
                      ? { ...s, status: "failed" as const, detail: "Skipped — earlier step failed" }
                      : s
            );
            await ctx.db.patch(runId, { status: "failed", steps, error: "boom" });
        });

        const checkInsBefore = await t.run(async (ctx) => {
            return (
                await ctx.db
                    .query("kpiCheckIns")
                    .withIndex("by_ventureId", (q) => q.eq("ventureId", ventureId))
                    .collect()
            ).length;
        });
        expect(checkInsBefore).toBe(1);

        // Retry — must resume from the digest step, not re-record the KPI.
        const retried = await asUser.mutation(api.agentRuns.retryFailedRun, { runId });
        expect(retried.runId).toBe(runId); // same run, not a new one
        await drain(t);

        const checkInsAfter = await t.run(async (ctx) => {
            return (
                await ctx.db
                    .query("kpiCheckIns")
                    .withIndex("by_ventureId", (q) => q.eq("ventureId", ventureId))
                    .collect()
            ).length;
        });
        expect(checkInsAfter).toBe(1); // no duplicate
    });

    test("retryFailedRun preserves actionPlan, approvedSummary, and correlationId", async () => {
        const t = initTest();
        const { investorId, asUser } = await createInvestor(t, "alice@test.com");
        const { ventureId, commitmentId } = await createVentureWithCommitment(t, investorId);
        const proposalId = await seedProposal(t, commitmentId, ventureId);

        const approvedText = "Jua confirmed 4 completed jobs with the founder.";
        await asUser.mutation(api.agentRuns.approveProposal, {
            runId: proposalId,
            publicSummary: approvedText,
        });
        await drain(t);

        const before = await t.run(async (ctx) => {
            const run = await ctx.db.get(proposalId);
            return {
                correlationId: run?.correlationId,
                approvedSummary: run?.approvedSummary,
                whyNow: run?.actionPlan?.reason.whyNow,
                planSteps: run?.actionPlan?.planSteps.length ?? 0,
            };
        });
        expect(before.correlationId).toBeTruthy();
        expect(before.approvedSummary).toBe(approvedText);
        expect(before.planSteps).toBeGreaterThan(0);

        // Force the waiting run to a failed state (e.g. the founder request
        // step failed after approval), then retry it for real.
        await t.run(async (ctx) => {
            const run = await ctx.db.get(proposalId);
            if (!run) throw new Error("run missing");
            const steps = run.steps.map((s) =>
                s.tool === "send_founder_request"
                    ? { ...s, status: "failed" as const, detail: "outbox down" }
                    : s.status === "pending"
                      ? { ...s, status: "failed" as const, detail: "Skipped — earlier step failed" }
                      : s
            );
            await ctx.db.patch(proposalId, { status: "failed", steps, error: "outbox down" });
        });

        const retried = await asUser.mutation(api.agentRuns.retryFailedRun, { runId: proposalId });
        expect(retried.runId).toBe(proposalId);
        await drain(t);

        const after = await t.run(async (ctx) => ctx.db.get(proposalId));
        expect(after?.correlationId).toBe(before.correlationId);
        expect(after?.approvedSummary).toBe(approvedText);
        expect(after?.actionPlan?.reason.whyNow).toBe(before.whyNow);
        expect(after?.actionPlan?.planSteps.length).toBe(before.planSteps);
        // The retried run re-parked waiting for evidence; no public effect yet.
        expect(after?.status).toBe("waiting_for_response");
    });
});

// ---------------------------------------------------------------------------
// 6. auto_low_risk only automates the private request
// ---------------------------------------------------------------------------
describe("auto_low_risk autonomy", () => {
    test("auto_low_risk auto-sends the private request but parks before any public effect", async () => {
        const t = initTest();
        const { investorId } = await createInvestor(t, "alice@test.com", {
            autonomyLevel: "auto_low_risk",
        });
        const { ventureId, commitmentId } = await createVentureWithCommitment(t, investorId);

        // Backdate the commitment so the staleness cron proposes.
        await t.run(async (ctx) => {
            await ctx.db.patch(commitmentId, { createdAt: Date.now() - 3 * 24 * 3600 * 1000 });
        });

        await t.mutation(internal.agentRuns.proposeProactiveCheckIns, {});
        await drain(t);

        const state = await t.run(async (ctx) => {
            const runs = await ctx.db
                .query("agentRuns")
                .withIndex("by_commitmentId", (q) => q.eq("commitmentId", commitmentId))
                .collect();
            const checkIns = await ctx.db
                .query("kpiCheckIns")
                .withIndex("by_ventureId", (q) => q.eq("ventureId", ventureId))
                .collect();
            const publicEvents = await ctx.db
                .query("ledgerEvents")
                .withIndex("by_publicVisible_and_createdAt", (q) => q.eq("publicVisible", true))
                .collect();
            return { run: runs[0], checkIns, publicEvents };
        });

        // The request was auto-sent and the run parked — no KPI, no public event.
        expect(state.run?.status).toBe("waiting_for_response");
        expect(state.run?.autoStarted).toBe(true);
        expect(state.checkIns).toHaveLength(0);
        expect(state.publicEvents).toHaveLength(0);
    });

    test("evidence on an auto-started run parks it back for explicit approval", async () => {
        const t = initTest();
        const { investorId, asUser } = await createInvestor(t, "alice@test.com", {
            autonomyLevel: "auto_low_risk",
        });
        const { ventureId, commitmentId } = await createVentureWithCommitment(t, investorId);

        await t.run(async (ctx) => {
            await ctx.db.patch(commitmentId, { createdAt: Date.now() - 3 * 24 * 3600 * 1000 });
        });
        await t.mutation(internal.agentRuns.proposeProactiveCheckIns, {});
        await drain(t);

        const runId = await t.run(async (ctx) => {
            const run = await ctx.db
                .query("agentRuns")
                .withIndex("by_commitmentId", (q) => q.eq("commitmentId", commitmentId))
                .first();
            return run!._id;
        });

        // Founder submits evidence — must NOT auto-publish; parks awaiting the
        // second approval (publication consent).
        await asUser.mutation(api.agentRuns.submitFounderEvidence, { runId, value: 3 });
        await drain(t);

        const state = await t.run(async (ctx) => {
            const run = await ctx.db.get(runId);
            const checkIns = await ctx.db
                .query("kpiCheckIns")
                .withIndex("by_ventureId", (q) => q.eq("ventureId", ventureId))
                .collect();
            const publicEvents = await ctx.db
                .query("ledgerEvents")
                .withIndex("by_publicVisible_and_createdAt", (q) => q.eq("publicVisible", true))
                .collect();
            return { run, checkIns, publicEvents };
        });

        expect(state.run?.status).toBe("awaiting_publication");
        expect(state.run?.autoStarted).toBe(false);
        expect(state.checkIns).toHaveLength(0);
        expect(state.publicEvents).toHaveLength(0);

        // Second approval now records + publishes.
        await asUser.mutation(api.agentRuns.publishApproval, { runId });
        await drain(t);

        const final = await t.run(async (ctx) => {
            const run = await ctx.db.get(runId);
            const checkIns = await ctx.db
                .query("kpiCheckIns")
                .withIndex("by_ventureId", (q) => q.eq("ventureId", ventureId))
                .collect();
            return { run, checkIns };
        });
        expect(final.run?.status).toBe("completed");
        expect(final.checkIns).toHaveLength(1);
        expect(final.checkIns[0]?.value).toBe(3);
    });
});

// ---------------------------------------------------------------------------
// 7. Standalone and inline approvals share one persisted contract
// ---------------------------------------------------------------------------
describe("canonical proposal detail", () => {
    test("getProposalDetail returns the persisted actionPlan, not a fallback", async () => {
        const t = initTest();
        const { investorId, asUser } = await createInvestor(t, "alice@test.com");
        const { ventureId, commitmentId } = await createVentureWithCommitment(t, investorId);
        const proposalId = await seedProposal(t, commitmentId, ventureId);

        // Run queries are ownership-gated — query as the owning investor.
        const detail = await asUser.query(api.agentRuns.getProposalDetail, { runId: proposalId });
        expect(detail).not.toBeNull();
        // The persisted plan's reason references the real venture + metric label.
        expect(detail!.ventureName).toBe("Test Venture");
        expect(detail!.reason.whyNow).toContain("Test Venture");
        expect(detail!.planSteps.length).toBeGreaterThan(0);
        // Preview carries the plan's message draft (not a hardcoded stale one).
        expect(detail!.preview.messageDraft).toBeTruthy();
    });

    test("getProposalDetail returns null for non-proposed runs", async () => {
        const t = initTest();
        const { investorId, asUser } = await createInvestor(t, "alice@test.com");
        const { ventureId, commitmentId } = await createVentureWithCommitment(t, investorId);
        const proposalId = await seedProposal(t, commitmentId, ventureId);

        await asUser.mutation(api.agentRuns.approveProposal, { runId: proposalId });
        await drain(t);

        const detail = await asUser.query(api.agentRuns.getProposalDetail, { runId: proposalId });
        expect(detail).toBeNull();
    });

    test("getProposalDetail is ownership-gated for other investors", async () => {
        const t = initTest();
        const { investorId } = await createInvestor(t, "alice@test.com");
        const { ventureId, commitmentId } = await createVentureWithCommitment(t, investorId);
        const proposalId = await seedProposal(t, commitmentId, ventureId);

        const { asUser: asBob } = await createInvestor(t, "bob@test.com");
        const detail = await asBob.query(api.agentRuns.getProposalDetail, { runId: proposalId });
        expect(detail).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// 8. Founder mutations enforce ownership
// ---------------------------------------------------------------------------
describe("founder ownership enforcement", () => {
    test("postVentureUpdate rejects a user who does not own a venture", async () => {
        const t = initTest();
        const { asUser } = await createInvestor(t, "alice@test.com");
        await expect(
            asUser.mutation(api.venture.postVentureUpdate, { body: "Update", tag: "win" })
        ).rejects.toThrow(/claim/i);
    });

    test("logSelfCheckIn rejects a user who does not own a venture", async () => {
        const t = initTest();
        const { asUser } = await createInvestor(t, "alice@test.com");
        await expect(asUser.mutation(api.venture.logSelfCheckIn, { value: 5 })).rejects.toThrow(
            /venture/i
        );
    });

    test("claimVenture links the venture to the signed-in user", async () => {
        const t = initTest();
        const { asUser, userId } = await createInvestor(t, "alice@test.com");
        // Seed an unowned active venture.
        await t.run(async (ctx) => {
            await ctx.db.insert("ventures", {
                name: "Claimable Venture",
                craftText: "Tailoring",
                craftKey: "tailoring",
                locationText: "Mombasa",
                locationKey: "mombasa",
                summary: "Claimable.",
                kpiLabel: "Revenue (KES)",
                kpiUnit: "revenue_kes",
                kpiTarget: 1000,
                publicSlug: "claimable-venture",
                status: "active",
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });
        });

        const result = await asUser.mutation(api.venture.claimVenture, {});
        expect(result.ventureId).toBeTruthy();

        const owner = await t.run(async (ctx) => {
            return await ctx.db
                .query("ventureOwners")
                .withIndex("by_userId", (q) => q.eq("userId", userId))
                .first();
        });
        expect(owner?.ventureId).toBe(result.ventureId);
    });
});
