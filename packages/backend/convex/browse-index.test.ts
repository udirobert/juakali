/**
 * Regression tests for the global ventureBrowse index.
 *
 * The cockpit's availableVentures browse list and the landing browse
 * (listVentures / listVenturesViaMcp) read one singleton doc maintained by
 * syncVentureBrowse instead of re-scanning every venture + KPI + pledge on
 * each query evaluation. Guards:
 *   - a mutation-created venture enters the browse index,
 *   - a logged KPI refreshes kpiLatest/kpiTotal in the browse doc,
 *   - a pledge refreshes pledgedKes in the browse doc,
 *   - the cockpit filters inactive ventures out of the browse list,
 *   - the scan fallback renders the same list before the index exists.
 */
import { convexTest } from "convex-test";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import rateLimiterTest from "@convex-dev/rate-limiter/test";

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

async function insertVenture(
    t: ReturnType<typeof initTest>,
    slug: string,
    status: "active" | "paused" | "graduated" = "active"
) {
    return await t.run(async (ctx) => {
        return await ctx.db.insert("ventures", {
            name: slug,
            craftText: "Welding",
            craftKey: "welding",
            locationText: "Nairobi",
            locationKey: "nairobi",
            summary: "A test venture.",
            kpiLabel: "Jobs completed",
            kpiUnit: "jobs",
            kpiTarget: 10,
            agentEmail: `${slug}@agent.juakali.demo`,
            publicSlug: slug,
            status,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
    });
}

async function syncBrowse(t: ReturnType<typeof initTest>) {
    await t.run(async (ctx) => {
        const { syncVentureBrowse } = await import("./investorBriefing");
        await syncVentureBrowse(ctx);
    });
}

beforeEach(() => {
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
});

describe("venture browse index", () => {
    test("a mutation-created venture enters the browse index and cockpit list", async () => {
        const t = initTest();
        const { investorId, asUser } = await createInvestor(t, "alice@browse.test");

        await asUser.mutation(api.invest.createVenture, {
            name: "New Venture",
            craftText: "Tailoring",
            locationText: "Nairobi",
            kpiLabel: "Orders",
            kpiUnit: "jobs",
            kpiTarget: 10,
            publicSlug: "new-venture",
        });

        const cockpit = await asUser.query(api.invest.investorCockpit, { investorId });
        expect(cockpit.availableVentures.map((v) => v.publicSlug)).toContain("new-venture");

        // The landing browse reads the same doc.
        const landing = await asUser.query(api.invest.listVentures, {});
        expect(landing.ventures.map((v) => v.publicSlug)).toContain("new-venture");
    });

    test("a logged KPI refreshes kpiLatest/kpiTotal in the browse doc", async () => {
        const t = initTest();
        const { asUser } = await createInvestor(t, "bob@browse.test");
        const { ventureId } = await asUser.mutation(api.invest.createVenture, {
            name: "KPI Venture",
            craftText: "Sales",
            locationText: "Mombasa",
            kpiLabel: "Meetings",
            kpiUnit: "meetings",
            kpiTarget: 12,
            publicSlug: "kpi-venture",
        });

        const before = await t.run(async (ctx) => {
            const doc = await ctx.db.query("ventureBrowse").first();
            return doc?.ventures.find((v) => v.id === ventureId) ?? null;
        });
        expect(before?.kpiLatest).toBe(0);
        expect(before?.kpiTotal).toBe(0);

        await asUser.mutation(api.invest.logKpiCheckIn, {
            ventureId,
            metric: "meetings_booked",
            value: 5,
            note: "Two clinics + one admin",
        });

        const after = await t.run(async (ctx) => {
            const doc = await ctx.db.query("ventureBrowse").first();
            return doc?.ventures.find((v) => v.id === ventureId) ?? null;
        });
        expect(after?.kpiLatest).toBe(5);
        expect(after?.kpiTotal).toBe(5);
    });

    test("a pledge refreshes pledgedKes in the browse doc", async () => {
        const t = initTest();
        const { investorId, asUser } = await createInvestor(t, "carol@browse.test");
        const { ventureId } = await asUser.mutation(api.invest.createVenture, {
            name: "Pledge Venture",
            craftText: "Food",
            locationText: "Kisumu",
            kpiLabel: "Revenue (KES)",
            kpiUnit: "revenue_kes",
            kpiTarget: 20000,
            publicSlug: "pledge-venture",
        });

        await asUser.mutation(api.invest.pledgeCommitment, {
            investorId,
            ventureId,
            amountKes: 15000,
        });

        const doc = await t.run(async (ctx) => {
            const browse = await ctx.db.query("ventureBrowse").first();
            return browse?.ventures.find((v) => v.id === ventureId) ?? null;
        });
        expect(doc?.pledgedKes).toBe(15000);
    });

    test("the cockpit filters inactive ventures out of the browse list", async () => {
        const t = initTest();
        const { investorId, asUser } = await createInvestor(t, "dana@browse.test");
        const { ventureId } = await asUser.mutation(api.invest.createVenture, {
            name: "Paused Venture",
            craftText: "Carpentry",
            locationText: "Nakuru",
            kpiLabel: "Jobs",
            kpiUnit: "jobs",
            kpiTarget: 8,
            publicSlug: "paused-venture",
        });

        // No mutation path changes status — patch directly, then re-sync.
        await t.run(async (ctx) => {
            await ctx.db.patch(ventureId, { status: "paused", updatedAt: Date.now() });
        });
        await syncBrowse(t);

        const cockpit = await asUser.query(api.invest.investorCockpit, { investorId });
        expect(cockpit.availableVentures.map((v) => v.publicSlug)).not.toContain("paused-venture");

        // The landing browse keeps the venture (status is carried in the summary).
        const landing = await asUser.query(api.invest.listVentures, {});
        expect(landing.ventures.map((v) => v.publicSlug)).toContain("paused-venture");
        expect(landing.ventures.find((v) => v.id === ventureId)?.status).toBe("paused");
    });

    test("scan fallback renders the same list before the index exists", async () => {
        const t = initTest();
        const { investorId, asUser } = await createInvestor(t, "erin@browse.test");
        // Direct inserts only — no mutation → no browse doc → scan fallback.
        await insertVenture(t, "direct-active");
        await insertVenture(t, "direct-paused", "paused");

        const cockpit = await asUser.query(api.invest.investorCockpit, { investorId });
        expect(cockpit.availableVentures.map((v) => v.publicSlug)).toContain("direct-active");
        expect(cockpit.availableVentures.map((v) => v.publicSlug)).not.toContain("direct-paused");

        const landing = await asUser.query(api.invest.listVentures, {});
        expect(landing.ventures.map((v) => v.publicSlug)).toEqual(
            expect.arrayContaining(["direct-active", "direct-paused"])
        );
    });
});
