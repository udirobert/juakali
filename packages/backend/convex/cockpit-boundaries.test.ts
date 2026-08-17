import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";

import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.*s");
type TestApp = ReturnType<typeof convexTest>;

function makeTest() {
    const t = convexTest(schema, modules);
    registerRateLimiter(t);
    return t;
}

async function createInvestor(t: TestApp, email: string) {
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

async function createCommitment(t: TestApp, investorId: Id<"investors">) {
    return await t.run(async (ctx) => {
        const ventureId = await ctx.db.insert("ventures", {
            name: "Private Venture",
            craftText: "Food processing",
            craftKey: "food-processing",
            locationText: "Nairobi",
            locationKey: "nairobi",
            summary: "Private investor data.",
            kpiLabel: "Revenue",
            kpiUnit: "revenue_kes",
            kpiTarget: 10000,
            publicSlug: `private-venture-${String(investorId).slice(-6)}`,
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
            thesis: "Private thesis",
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
        return { ventureId, commitmentId };
    });
}

describe("investor cockpit authorization", () => {
    test("anonymous callers cannot resolve a commitment id into private cockpit data", async () => {
        const t = makeTest();
        const alice = await createInvestor(t, "alice@cockpit.test");
        const { commitmentId } = await createCommitment(t, alice.investorId);

        const result = await t.query(api.invest.investorCockpit, { commitmentId });

        expect(result.investor).toBeNull();
        expect(result.commitments).toHaveLength(0);
    });

    test("a different investor cannot use an investor id or commitment id as access", async () => {
        const t = makeTest();
        const alice = await createInvestor(t, "alice@cockpit.test");
        const bob = await createInvestor(t, "bob@cockpit.test");
        const { commitmentId } = await createCommitment(t, alice.investorId);

        const byInvestor = await bob.asUser.query(api.invest.investorCockpit, {
            investorId: alice.investorId,
        });
        const byCommitment = await bob.asUser.query(api.invest.investorCockpit, {
            commitmentId,
        });

        expect(byInvestor.investor).toBeNull();
        expect(byInvestor.commitments).toHaveLength(0);
        expect(byCommitment.investor).toBeNull();
        expect(byCommitment.commitments).toHaveLength(0);
    });

    test("the owning investor can resolve their own cockpit", async () => {
        const t = makeTest();
        const alice = await createInvestor(t, "alice@cockpit.test");
        const { commitmentId } = await createCommitment(t, alice.investorId);

        const result = await alice.asUser.query(api.invest.investorCockpit, { commitmentId });

        expect(result.investor?.id).toBe(alice.investorId);
        expect(result.commitments.map((row) => row.id)).toContain(commitmentId);
    });
});
