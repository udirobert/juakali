/**
 * Founder-side routing and evidence provenance.
 *
 * Guards:
 *  - openFounderRequests is scoped to the owner's venture (no cross-venture leak).
 *  - postVentureUpdate refuses to guess when a venture has multiple investor
 *    relationships, and requires an explicit commitmentId.
 *  - A selected commitment must belong to the owned venture (ownership check).
 *  - A founder update answers the waiting run for the selected commitment and
 *    records founder_update provenance — never investor_entered.
 *  - Investor-entered evidence is preserved as investor_entered, distinct from
 *    founder-submitted evidence.
 */
import { convexTest } from "convex-test";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import type { Id } from "./_generated/dataModel";

function initTest() {
    const t = convexTest(schema, import.meta.glob("./**/*.*s"));
    registerRateLimiter(t);
    return t;
}

type TestApp = ReturnType<typeof initTest>;

async function createUser(t: TestApp, email: string) {
    const userId = await t.run((ctx) =>
        ctx.db.insert("users", { email, name: email.split("@")[0] })
    );
    const investorId = await t.run((ctx) =>
        ctx.db.insert("investors", {
            displayName: email.split("@")[0]!,
            email,
            phone: null,
            userId,
            isDefaultDemo: false,
            autonomyLevel: "ask_every_time",
            createdAt: Date.now(),
        })
    );
    return {
        userId,
        investorId,
        asUser: t.withIdentity({
            subject: `${userId}|session`,
            tokenIdentifier: `test|${userId}|session`,
            issuer: "test",
        }),
    };
}

async function createVenture(
    t: TestApp,
    ownerUserId: Id<"users">,
    slug: string
): Promise<Id<"ventures">> {
    return await t.run(async (ctx) => {
        const ventureId = await ctx.db.insert("ventures", {
            name: `Venture ${slug}`,
            craftText: "Food processing",
            craftKey: "food-processing",
            locationText: "Nairobi",
            locationKey: "nairobi",
            summary: "Test venture.",
            kpiLabel: "Revenue",
            kpiUnit: "revenue_kes",
            kpiTarget: 10000,
            agentEmail: `${slug}@agent.juakali.demo`,
            publicSlug: slug,
            status: "active",
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
        await ctx.db.insert("ventureOwners", {
            userId: ownerUserId,
            ventureId,
            role: "owner",
            createdAt: Date.now(),
        });
        return ventureId;
    });
}

async function addCommitment(
    t: TestApp,
    ventureId: Id<"ventures">,
    investorId: Id<"investors">
): Promise<Id<"commitments">> {
    return await t.run((ctx) =>
        ctx.db.insert("commitments", {
            investorId,
            ventureId,
            amountKes: 10000,
            shareBps: 1000,
            capMultiple: 2,
            status: "active",
            thesis: "Test thesis",
            createdAt: Date.now(),
            updatedAt: Date.now(),
        })
    );
}

/** Park a proactive run for a commitment in waiting_for_response. */
async function parkWaitingRun(
    t: TestApp,
    commitmentId: Id<"commitments">,
    ventureId: Id<"ventures">,
    investorId: Id<"investors">
): Promise<Id<"agentRuns">> {
    return await t.run((ctx) =>
        ctx.db.insert("agentRuns", {
            commitmentId,
            ventureId,
            investorId,
            status: "waiting_for_response",
            trigger: "proactive",
            noteBody: "Please share this week's Revenue.",
            subject: "Check-in",
            metricOverride: null,
            valueOverride: null,
            fromAddress: "jua@agent.juakali.demo",
            toAddress: `${ventureId}@agent.juakali.demo`,
            source: "agent",
            steps: [
                { tool: "send_founder_request", label: "Request check-in", status: "done", detail: null },
                { tool: "log_kpi_checkin", label: "Log KPI", status: "pending", detail: null },
                { tool: "create_investor_digest", label: "Write digest", status: "pending", detail: null },
                { tool: "post_public_ledger", label: "Post to ledger", status: "pending", detail: null },
                { tool: "send_reply", label: "Send reply", status: "pending", detail: null },
            ],
            correlationId: `proposal_${Date.now()}_${commitmentId}`,
            result: null,
            error: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        })
    );
}

async function drain(t: TestApp) {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("founder request targeting", () => {
    test("openFounderRequests is scoped to the owned venture", async () => {
        const t = initTest();
        const owner = await createUser(t, "owner@test.com");
        const investor = await createUser(t, "alice@test.com");
        const ventureId = await createVenture(t, owner.userId, "owned");
        const otherId = await createVenture(t, owner.userId, "other");
        const c1 = await addCommitment(t, ventureId, investor.investorId);
        const c2 = await addCommitment(t, otherId, investor.investorId);
        await parkWaitingRun(t, c1, ventureId, investor.investorId);
        await parkWaitingRun(t, c2, otherId, investor.investorId);

        const requests = await owner.asUser.query(api.venture.openFounderRequests, {});
        expect(requests).toHaveLength(1);
        expect(requests[0]!.commitmentId).toBe(c1);
    });

    test("multi-investor venture requires an explicit commitmentId", async () => {
        const t = initTest();
        const owner = await createUser(t, "owner@test.com");
        const alice = await createUser(t, "alice@test.com");
        const bob = await createUser(t, "bob@test.com");
        const ventureId = await createVenture(t, owner.userId, "multi");
        await addCommitment(t, ventureId, alice.investorId);
        await addCommitment(t, ventureId, bob.investorId);

        await expect(
            owner.asUser.mutation(api.venture.postVentureUpdate, {
                body: "Good week",
                tag: "win",
                kpiValue: 5,
            })
        ).rejects.toThrow(/multiple investor relationships/i);
    });

    test("founder update answers the selected investor's request", async () => {
        const t = initTest();
        const owner = await createUser(t, "owner@test.com");
        const alice = await createUser(t, "alice@test.com");
        const bob = await createUser(t, "bob@test.com");
        const ventureId = await createVenture(t, owner.userId, "multi2");
        const aliceCommitment = await addCommitment(t, ventureId, alice.investorId);
        const bobCommitment = await addCommitment(t, ventureId, bob.investorId);
        const aliceRun = await parkWaitingRun(t, aliceCommitment, ventureId, alice.investorId);
        const bobRun = await parkWaitingRun(t, bobCommitment, ventureId, bob.investorId);

        const result = await owner.asUser.mutation(api.venture.postVentureUpdate, {
            body: "Revenue up",
            tag: "win",
            kpiValue: 9,
            commitmentId: aliceCommitment,
        });
        await drain(t);

        // Only Alice's run resumed; Bob's request is untouched.
        expect(result.runId).toBe(aliceRun);
        const aliceState = await t.run(async (ctx) => ctx.db.get(aliceRun));
        const bobState = await t.run(async (ctx) => ctx.db.get(bobRun));
        expect(aliceState?.status).toBe("completed");
        expect(aliceState?.evidenceSource).toBe("founder_update");
        expect(bobState?.status).toBe("waiting_for_response");

        // The check-in records founder provenance (not investor-entered).
        const checkIns = await t.run(async (ctx) =>
            ctx.db
                .query("kpiCheckIns")
                .withIndex("by_ventureId", (q) => q.eq("ventureId", ventureId))
                .collect()
        );
        expect(checkIns).toHaveLength(1);
        expect(checkIns[0]!.value).toBe(9);
        expect(checkIns[0]!.evidenceSource).toBe("founder_update");
    });

    test("a commitment from another venture is rejected", async () => {
        const t = initTest();
        const owner = await createUser(t, "owner@test.com");
        const investor = await createUser(t, "alice@test.com");
        const ventureId = await createVenture(t, owner.userId, "owned");
        const otherId = await createVenture(t, owner.userId, "other");
        await addCommitment(t, ventureId, investor.investorId);
        const otherCommitment = await addCommitment(t, otherId, investor.investorId);

        await expect(
            owner.asUser.mutation(api.venture.postVentureUpdate, {
                body: "Wrong target",
                tag: "win",
                kpiValue: 3,
                commitmentId: otherCommitment,
            })
        ).rejects.toThrow(/does not belong to your venture/i);
    });
});

describe("evidence provenance", () => {
    test("investor-entered evidence stays investor_entered, not founder", async () => {
        const t = initTest();
        const alice = await createUser(t, "alice@test.com");
        const ventureId = await createVenture(t, alice.userId, "prov");
        const commitmentId = await addCommitment(t, ventureId, alice.investorId);
        const runId = await parkWaitingRun(t, commitmentId, ventureId, alice.investorId);

        // The investor records a number they received from the founder.
        await alice.asUser.mutation(api.agentRuns.submitFounderEvidence, {
            runId,
            value: 4,
            note: "Received from founder",
        });
        await drain(t);

        const run = await t.run(async (ctx) => ctx.db.get(runId));
        const checkIns = await t.run(async (ctx) =>
            ctx.db
                .query("kpiCheckIns")
                .withIndex("by_ventureId", (q) => q.eq("ventureId", ventureId))
                .collect()
        );
        expect(run?.evidenceSource).toBe("investor_entered");
        expect(checkIns[0]!.evidenceSource).toBe("investor_entered");
        // The immutable evidence record carries the same provenance.
        const evidence = await t.run(async (ctx) =>
            ctx.db.query("founderEvidence").withIndex("by_runId", (q) => q.eq("runId", runId)).first()
        );
        expect(evidence?.source).toBe("investor_entered");
    });
});
