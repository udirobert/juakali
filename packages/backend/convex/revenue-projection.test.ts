/**
 * Revenue-only projection: the cockpit's capProgress.estimatedShareKes is
 * derived solely from self-reported `revenue_kes` check-ins recorded after the
 * pledge — jobs, meetings, and absent data never become money.
 */
import { convexTest } from "convex-test";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import type { Id } from "./_generated/dataModel";
import { formatPublicPledge } from "./publicCopy";

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
    createdAt = Date.now()
) {
    return await t.run(async (ctx) => {
        const ventureId = await ctx.db.insert("ventures", {
            name: "Test Venture",
            craftText: "Welding",
            craftKey: "welding",
            locationText: "Nairobi",
            locationKey: "nairobi",
            summary: "A test venture.",
            kpiLabel: "Revenue (KES)",
            kpiUnit: "revenue_kes",
            kpiTarget: 10_000,
            agentEmail: "test@agent.juakali.demo",
            publicSlug: "test-venture",
            status: "active",
            createdAt,
            updatedAt: createdAt,
        });
        const commitmentId = await ctx.db.insert("commitments", {
            investorId,
            ventureId,
            amountKes: 10_000,
            shareBps: 1000,
            capMultiple: 2,
            status: "active",
            thesis: "Test thesis.",
            createdAt,
            updatedAt: createdAt,
        });
        return { ventureId, commitmentId };
    });
}

async function syncInvestor(
    t: ReturnType<typeof initTest>,
    investorId: Id<"investors">
) {
    await t.run(async (ctx) => {
        const { syncInvestorBriefing } = await import("./investorBriefing");
        await syncInvestorBriefing(ctx, investorId);
    });
}

async function insertCheckIn(
    t: ReturnType<typeof initTest>,
    ventureId: Id<"ventures">,
    metric: string,
    value: number,
    createdAt = Date.now()
) {
    await t.run(async (ctx) => {
        await ctx.db.insert("kpiCheckIns", {
            ventureId,
            commitmentId: null,
            periodLabel: "Test",
            metric,
            value,
            note: "test",
            source: "self",
            createdAt,
        });
    });
}

beforeEach(() => {
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
});

describe("capProgress.estimatedShareKes", () => {
    test("no estimate from jobs/meetings alone", async () => {
        const t = initTest();
        const { investorId, asUser } = await createInvestor(t, "a@t.com");
        const { ventureId } = await createVentureWithCommitment(t, investorId);
        await insertCheckIn(t, ventureId, "jobs_completed", 4);
        await insertCheckIn(t, ventureId, "meetings_booked", 2);
        await syncInvestor(t, investorId);

        const cockpit = await asUser.query(api.invest.investorCockpit, {});
        const row = cockpit.commitments[0]!;
        expect(row.capProgress.reportedRevenueKes).toBeNull();
        expect(row.capProgress.estimatedShareKes).toBeNull();
    });

    test("mixed metrics: only revenue_kes feeds the estimate", async () => {
        const t = initTest();
        const { investorId, asUser } = await createInvestor(t, "a@t.com");
        const { ventureId } = await createVentureWithCommitment(t, investorId);
        await insertCheckIn(t, ventureId, "revenue_kes", 7800);
        await insertCheckIn(t, ventureId, "jobs_completed", 4);
        await insertCheckIn(t, ventureId, "revenue_kes", 200);
        await syncInvestor(t, investorId);

        const cockpit = await asUser.query(api.invest.investorCockpit, {});
        const row = cockpit.commitments[0]!;
        expect(row.capProgress.reportedRevenueKes).toBe(8000);
        // 10% of reported revenue, capped at 2× pledge.
        expect(row.capProgress.estimatedShareKes).toBe(800);
        expect(row.capProgress.capKes).toBe(20_000);
    });

    test("check-ins before the pledge are not counted", async () => {
        const t = initTest();
        const pledgeAt = Date.now();
        const { investorId, asUser } = await createInvestor(t, "a@t.com");
        const { ventureId } = await createVentureWithCommitment(t, investorId, pledgeAt);
        await insertCheckIn(t, ventureId, "revenue_kes", 7800, pledgeAt - 60_000);
        await insertCheckIn(t, ventureId, "revenue_kes", 500, pledgeAt + 60_000);
        await syncInvestor(t, investorId);

        const cockpit = await asUser.query(api.invest.investorCockpit, {});
        expect(cockpit.commitments[0]!.capProgress.reportedRevenueKes).toBe(500);
        expect(cockpit.commitments[0]!.capProgress.estimatedShareKes).toBe(50);
    });

    test("reported zero yields estimate 0 — distinct from absent data", async () => {
        const t = initTest();
        const { investorId, asUser } = await createInvestor(t, "a@t.com");
        const { ventureId } = await createVentureWithCommitment(t, investorId);
        await insertCheckIn(t, ventureId, "revenue_kes", 0);
        await syncInvestor(t, investorId);

        const cockpit = await asUser.query(api.invest.investorCockpit, {});
        const row = cockpit.commitments[0]!;
        expect(row.capProgress.reportedRevenueKes).toBe(0);
        expect(row.capProgress.estimatedShareKes).toBe(0);
    });

    test("old projection rows without the new field produce no estimate", async () => {
        const t = initTest();
        const { investorId, asUser } = await createInvestor(t, "a@t.com");
        const { ventureId } = await createVentureWithCommitment(t, investorId);
        await insertCheckIn(t, ventureId, "revenue_kes", 7800);

        // A briefing doc stored before reportedRevenueKes existed.
        await t.run(async (ctx) => {
            const { buildVentureSummary } = await import("./investorBriefing");
            const venture = await buildVentureSummary(ctx, ventureId);
            if (!venture) throw new Error("missing venture");
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
                cockpit: [
                    {
                        commitmentId: (await ctx.db
                            .query("commitments")
                            .withIndex("by_investorId", (q) => q.eq("investorId", investorId))
                            .first())!._id,
                        venture,
                        latestDigest: null,
                        recentCheckIns: [],
                        recentEmails: [],
                        openProposal: null,
                    },
                ],
                presence: { lastWorkedAt: null, runsThisWeek: 0, openProposals: 0 },
                updatedAt: Date.now(),
            });
        });

        const cockpit = await asUser.query(api.invest.investorCockpit, {});
        const row = cockpit.commitments[0]!;
        expect(row.capProgress.reportedRevenueKes).toBeNull();
        expect(row.capProgress.estimatedShareKes).toBeNull();
    });
});

describe("pledge preview exactness", () => {
    test("a signed-in investor's mutation summary equals the shared preview helper", async () => {
        const t = initTest();
        const { asUser } = await createInvestor(t, "alice@test.com");
        const ventureId = await t.run(async (ctx) =>
            ctx.db.insert("ventures", {
                name: "Kibera Studio",
                craftText: "Welding",
                craftKey: "welding",
                locationText: "Nairobi",
                locationKey: "nairobi",
                summary: "A test venture.",
                kpiLabel: "Revenue (KES)",
                kpiUnit: "revenue_kes",
                kpiTarget: 10_000,
                agentEmail: "kibera@agent.juakali.demo",
                publicSlug: "kibera-studio",
                status: "active",
                createdAt: Date.now(),
                updatedAt: Date.now(),
            })
        );

        // The confirm step passes the same resolved investorName it displayed.
        const preview = formatPublicPledge("alice", "KES", 5_000, "Kibera Studio");
        const result = await asUser.mutation(api.invest.pledgeCommitment, {
            ventureId,
            amountKes: 5_000,
            investorName: "alice",
        });

        const events = (await t.run(async (ctx) => ctx.db.query("ledgerEvents").collect())).filter(
            (e) => e.commitmentId === result.commitmentId
        );
        expect(events).toHaveLength(1);
        expect(events[0]!.summary).toBe(preview);
    });
});
