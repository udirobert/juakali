/**
 * Regression tests for the denormalized investor cockpit projection.
 *
 * investorCockpit now reads its per-commitment data (venture summary, latest
 * digest, recent check-ins/emails, open proposal) plus presence from the
 * investorBriefings index instead of scanning runs/digests/emails/KPIs per
 * commitment on every query evaluation. Guards:
 *   - the full pipeline populates the projection (summary, digest, check-ins,
 *     emails, presence),
 *   - open proposals surface per commitment with the presence count,
 *   - a logged KPI refreshes the projection (syncInvestorsForVenture),
 *   - the scan fallback renders the same row shape before the index exists.
 */
import { convexTest } from "convex-test";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { api } from "./_generated/api";
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

async function drain(t: ReturnType<typeof initTest>) {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
}

beforeEach(() => {
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
});

describe("investor cockpit index", () => {
    test("full pipeline populates the cockpit projection", async () => {
        const t = initTest();
        const { investorId, asUser } = await createInvestor(t, "alice@test.com");
        const { commitmentId } = await createVentureWithCommitment(t, investorId);

        // An evidence-backed run completes the whole pipeline (KPI → digest →
        // ledger → reply); the completion sync builds the cockpit projection.
        await asUser.mutation(api.agentRuns.startAgentRun, {
            commitmentId,
            noteBody: "Push follow-ups",
            metric: "jobs_completed",
            value: 2,
        });
        await drain(t);

        const cockpit = await asUser.query(api.invest.investorCockpit, {});
        expect(cockpit.commitments).toHaveLength(1);
        const row = cockpit.commitments[0]!;
        expect(row.id).toBe(commitmentId);
        expect(row.venture.name).toBe("Test Venture");
        expect(row.venture.kpiTotal).toBe(2);
        expect(row.venture.kpiLatest).toBe(2);
        expect(row.latestDigest).not.toBeNull();
        expect(row.latestDigest!.summary).toContain("logged jobs_completed = 2");
        expect(row.recentCheckIns).toHaveLength(1);
        expect(row.recentCheckIns[0]!.value).toBe(2);
        // createAgentRun wrote an inbound note + the pipeline sent a reply.
        expect(row.recentEmails.length).toBeGreaterThanOrEqual(2);
        expect(row.openProposal).toBeNull();
        // Presence reflects the completed run.
        expect(cockpit.agentPresence.lastWorkedAt).not.toBeNull();
        expect(cockpit.agentPresence.runsThisWeek).toBe(1);
        expect(cockpit.agentPresence.openProposals).toBe(0);
    });

    test("open proposal surfaces from the index with the presence count", async () => {
        const t = initTest();
        const { investorId, asUser } = await createInvestor(t, "alice@test.com");
        const { ventureId, commitmentId } = await createVentureWithCommitment(t, investorId);
        const proposalId = await seedProposal(t, commitmentId, ventureId);

        const cockpit = await asUser.query(api.invest.investorCockpit, {});
        expect(cockpit.commitments).toHaveLength(1);
        const row = cockpit.commitments[0]!;
        expect(row.openProposal).not.toBeNull();
        expect(row.openProposal!.id).toBe(proposalId);
        expect(row.openProposal!.subject).toBe("Check-in: Test Venture");
        expect(cockpit.agentPresence.openProposals).toBe(1);
        // Proposals alone are not "work done".
        expect(cockpit.agentPresence.lastWorkedAt).toBeNull();
        expect(cockpit.agentPresence.runsThisWeek).toBe(0);
    });

    test("a logged KPI refreshes the projection via syncInvestorsForVenture", async () => {
        const t = initTest();
        const { investorId, asUser } = await createInvestor(t, "alice@test.com");
        const { ventureId, commitmentId } = await createVentureWithCommitment(t, investorId);
        // Ensure a briefing doc exists before the KPI log.
        await seedProposal(t, commitmentId, ventureId);

        await asUser.mutation(api.invest.logKpiCheckIn, {
            ventureId,
            commitmentId,
            metric: "jobs_completed",
            value: 3,
        });

        const cockpit = await asUser.query(api.invest.investorCockpit, {});
        const row = cockpit.commitments[0]!;
        expect(row.recentCheckIns).toHaveLength(1);
        expect(row.recentCheckIns[0]!.value).toBe(3);
        expect(row.venture.kpiTotal).toBe(3);
        expect(row.venture.kpiLatest).toBe(3);
    });

    test("scan fallback renders the same row shape before the index exists", async () => {
        const t = initTest();
        const { investorId, asUser } = await createInvestor(t, "alice@test.com");
        const { commitmentId } = await createVentureWithCommitment(t, investorId);

        // Direct inserts only — no mutation has run, so no briefing doc exists
        // and the cockpit must use the legacy scan path.
        const cockpit = await asUser.query(api.invest.investorCockpit, {});
        expect(cockpit.commitments).toHaveLength(1);
        const row = cockpit.commitments[0]!;
        expect(row.id).toBe(commitmentId);
        expect(row.venture.name).toBe("Test Venture");
        expect(row.venture.kpiTotal).toBe(0);
        expect(row.latestDigest).toBeNull();
        expect(row.recentCheckIns).toHaveLength(0);
        expect(row.recentEmails).toHaveLength(0);
        expect(row.openProposal).toBeNull();
        expect(cockpit.agentPresence.lastWorkedAt).toBeNull();
        expect(cockpit.agentPresence.runsThisWeek).toBe(0);
        expect(cockpit.agentPresence.openProposals).toBe(0);
    });
});
