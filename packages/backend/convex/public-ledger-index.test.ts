/**
 * Regression tests for the denormalized venture metadata on ledger events.
 *
 * Ledger events now embed ventureName/ventureSlug at write time so the public
 * feed (publicLedger, getPublicLedgerViaMcp) renders names/slugs with zero
 * per-event venture lookups. Guards:
 *   - both writeLedgerEvent helpers embed the metadata,
 *   - the public queries read it (events + filter chips),
 *   - legacy rows without the fields still resolve via the cached fallback.
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

async function drain(t: ReturnType<typeof initTest>) {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
}

beforeEach(() => {
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
});

describe("public ledger venture metadata", () => {
    test("run-pipeline ledger events embed venture metadata", async () => {
        const t = initTest();
        const { investorId, asUser } = await createInvestor(t, "alice@test.com");
        const { commitmentId } = await createVentureWithCommitment(t, investorId);

        // An evidence-backed run records a KPI → agentRuns.writeLedgerEvent.
        await asUser.mutation(api.agentRuns.startAgentRun, {
            commitmentId,
            noteBody: "Push follow-ups",
            metric: "jobs_completed",
            value: 2,
        });
        await drain(t);

        const checkins = await t.run(async (ctx) => {
            return (await ctx.db.query("ledgerEvents").collect()).filter(
                (e) => e.type === "checkin"
            );
        });
        expect(checkins.length).toBeGreaterThan(0);
        for (const event of checkins) {
            expect(event.ventureName).toBe("Test Venture");
            expect(event.ventureSlug).toBe("test-venture");
        }
    });

    test("pledge events embed venture metadata via the invest helper", async () => {
        const t = initTest();
        const { investorId, asUser } = await createInvestor(t, "alice@test.com");
        const { ventureId } = await createVentureWithCommitment(t, investorId);

        await asUser.mutation(api.invest.pledgeCommitment, {
            investorId,
            ventureId,
            amountKes: 5000,
        });

        const pledges = await t.run(async (ctx) => {
            return (await ctx.db.query("ledgerEvents").collect()).filter(
                (e) => e.type === "pledge"
            );
        });
        expect(pledges.length).toBeGreaterThan(0);
        for (const event of pledges) {
            expect(event.ventureName).toBe("Test Venture");
            expect(event.ventureSlug).toBe("test-venture");
        }
    });

    test("publicLedger reads embedded metadata and lists the venture chip", async () => {
        const t = initTest();
        const { investorId } = await createInvestor(t, "alice@test.com");
        const { ventureId } = await createVentureWithCommitment(t, investorId);

        await t.run(async (ctx) => {
            await ctx.db.insert("ledgerEvents", {
                type: "action",
                ventureId,
                commitmentId: null,
                ventureName: "Test Venture",
                ventureSlug: "test-venture",
                summary: "Public action",
                createdAt: Date.now(),
                publicVisible: true,
            });
        });

        const ledger = await t.query(api.invest.publicLedger, {});
        const event = ledger.events.find((e) => e.summary === "Public action");
        expect(event).toBeDefined();
        expect(event!.ventureName).toBe("Test Venture");
        expect(event!.ventureSlug).toBe("test-venture");
        // Filter chips come from the same embedded metadata.
        expect(ledger.ventures.some((v) => v.slug === "test-venture")).toBe(true);
        expect(ledger.ventures.find((v) => v.slug === "test-venture")!.name).toBe("Test Venture");
    });

    test("legacy rows without embedded metadata resolve via the cached fallback", async () => {
        const t = initTest();
        const { investorId } = await createInvestor(t, "alice@test.com");
        const { ventureId } = await createVentureWithCommitment(t, investorId);

        // Legacy row: no ventureName/ventureSlug fields written.
        await t.run(async (ctx) => {
            await ctx.db.insert("ledgerEvents", {
                type: "action",
                ventureId,
                commitmentId: null,
                summary: "Legacy action",
                createdAt: Date.now(),
                publicVisible: true,
            });
        });

        const ledger = await t.query(api.invest.publicLedger, {});
        const event = ledger.events.find((e) => e.summary === "Legacy action");
        expect(event).toBeDefined();
        expect(event!.ventureName).toBe("Test Venture");
        expect(event!.ventureSlug).toBe("test-venture");
        expect(ledger.ventures.some((v) => v.slug === "test-venture")).toBe(true);
    });

    test("getPublicLedgerViaMcp resolves embedded metadata too", async () => {
        const t = initTest();
        const { investorId } = await createInvestor(t, "alice@test.com");
        const { ventureId } = await createVentureWithCommitment(t, investorId);

        await t.run(async (ctx) => {
            await ctx.db.insert("ledgerEvents", {
                type: "action",
                ventureId,
                commitmentId: null,
                ventureName: "Test Venture",
                ventureSlug: "test-venture",
                summary: "MCP action",
                createdAt: Date.now(),
                publicVisible: true,
            });
        });

        const ledger = await t.query(api.invest.getPublicLedgerViaMcp, {});
        const event = ledger.events.find((e) => e.summary === "MCP action");
        expect(event).toBeDefined();
        expect(event!.ventureName).toBe("Test Venture");
        expect(event!.ventureSlug).toBe("test-venture");
    });
});
