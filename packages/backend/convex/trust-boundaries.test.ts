import { convexTest } from "convex-test";
import { expect, describe, test } from "vitest";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { buildProactiveActionPlan } from "./actionPlan";
import { publishedSummaryForRun, retryStateForRun } from "./agentRuns";

const modules = import.meta.glob("./**/*.*s");

type TestApp = ReturnType<typeof convexTest>;

function makeTest() {
    const t = convexTest(schema, modules);
    registerRateLimiter(t);
    return t;
}

async function createUser(t: TestApp, email: string) {
    const userId = await t.run(async (ctx) =>
        ctx.db.insert("users", {
            email,
            name: email.split("@")[0],
        })
    );
    return {
        userId,
        asUser: t.withIdentity({
            subject: `${userId}|session`,
            tokenIdentifier: `test|${userId}|session`,
            issuer: "test",
        }),
    };
}

async function createDeal(t: TestApp, userId: Id<"users">) {
    return await t.run(async (ctx) => {
        const ventureId = await ctx.db.insert("ventures", {
            name: "Kijani Foods",
            craftText: "Food processing",
            craftKey: "food-processing",
            locationText: "Nairobi",
            locationKey: "nairobi",
            summary: "A small food venture.",
            kpiLabel: "Revenue",
            kpiUnit: "revenue_kes",
            kpiTarget: 10000,
            peerMedian: 8000,
            agentEmail: "kijani@agent.juakali.demo",
            publicSlug: "kijani-foods",
            status: "active",
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
        const investorId = await ctx.db.insert("investors", {
            displayName: "Alice",
            email: "alice@test.example",
            phone: null,
            userId,
            isDefaultDemo: false,
            autonomyLevel: "ask_every_time",
            createdAt: Date.now(),
        });
        const commitmentId = await ctx.db.insert("commitments", {
            investorId,
            ventureId,
            amountKes: 10000,
            shareBps: 1000,
            capMultiple: 2,
            status: "active",
            thesis: "Test thesis",
            digestCadence: "Weekly",
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
        return { ventureId, investorId, commitmentId };
    });
}

function proactiveSteps() {
    return [
        ["send_founder_request", "Request check-in"],
        ["log_kpi_checkin", "Log KPI"],
        ["create_investor_digest", "Write digest"],
        ["post_public_ledger", "Post to ledger"],
        ["send_reply", "Send reply"],
    ].map(([tool, label], index) => ({
        tool,
        label,
        status: index === 1 ? ("running" as const) : ("pending" as const),
        detail: null,
    }));
}

function evidenceSteps() {
    return [
        ["log_kpi_checkin", "Log KPI"],
        ["create_investor_digest", "Write digest"],
        ["post_public_ledger", "Post to ledger"],
        ["send_reply", "Send reply"],
    ].map(([tool, label], index) => ({
        tool,
        label,
        status: index === 2 ? ("running" as const) : ("done" as const),
        detail: null,
    }));
}

describe("trust boundaries", () => {
    test("proactive KPI execution parks without evidence and writes no public effects", async () => {
        const t = makeTest();
        const { userId } = await createUser(t, "alice@test.example");
        const { ventureId, investorId, commitmentId } = await createDeal(t, userId);
        const runId = await t.run(async (ctx) =>
            ctx.db.insert("agentRuns", {
                commitmentId,
                ventureId,
                investorId,
                status: "running",
                trigger: "proactive",
                noteBody: "Check in",
                subject: "Check-in",
                metricOverride: null,
                valueOverride: null,
                fromAddress: "jua@agent.juakali.demo",
                toAddress: "founder@agent.juakali.demo",
                source: "agent",
                steps: proactiveSteps(),
                actionPlan: buildProactiveActionPlan({
                    ventureName: "Kijani Foods",
                    daysStale: 2,
                    metricLabel: "Revenue",
                    lastCheckInAt: null,
                }),
                correlationId: "proactive-test",
                result: null,
                error: null,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            })
        );

        await t.mutation(internal.agentRuns.stepRecordKpi, { runId });

        const state = await t.run(async (ctx) => {
            const run = await ctx.db.get(runId);
            const checkIns = await ctx.db.query("kpiCheckIns").collect();
            const digests = await ctx.db.query("agentDigests").collect();
            const ledger = await ctx.db.query("ledgerEvents").collect();
            return { run, checkIns, digests, ledger };
        });

        expect(state.run?.status).toBe("waiting_for_response");
        expect(state.run?.pipeline?.evidenceId).toBeUndefined();
        expect(state.checkIns).toHaveLength(0);
        expect(state.digests).toHaveLength(0);
        expect(state.ledger).toHaveLength(0);
    });

    test("anonymous callers cannot retrieve private proof or private chain members", async () => {
        const t = makeTest();
        const { userId } = await createUser(t, "alice@test.example");
        const { ventureId, commitmentId } = await createDeal(t, userId);
        const { privateId, publicId } = await t.run(async (ctx) => {
            const privateId = await ctx.db.insert("ledgerEvents", {
                type: "action",
                ventureId,
                commitmentId,
                summary: "Private request",
                evidence: ["agent"],
                createdAt: Date.now(),
                publicVisible: false,
                correlationId: "privacy-chain",
            });
            const publicId = await ctx.db.insert("ledgerEvents", {
                type: "action",
                ventureId,
                commitmentId,
                summary: "Public effect",
                evidence: ["agent"],
                createdAt: Date.now() + 1,
                publicVisible: true,
                correlationId: "privacy-chain",
            });
            return { privateId, publicId };
        });

        expect(await t.query(api.invest.proofEvent, { eventId: privateId })).toBeNull();
        const publicProof = await t.query(api.invest.proofEvent, { eventId: publicId });
        expect(publicProof?.chain.map((event) => event.summary)).toEqual(["Public effect"]);
    });

    test("published ledger text equals the approved public summary", async () => {
        const t = makeTest();
        const { userId } = await createUser(t, "alice@test.example");
        const { ventureId, investorId, commitmentId } = await createDeal(t, userId);
        const approvedSummary = "Founder-approved wording — no hidden rewrite.";
        const runId = await t.run(async (ctx) =>
            ctx.db.insert("agentRuns", {
                commitmentId,
                ventureId,
                investorId,
                status: "running",
                trigger: "approved_note",
                noteBody: "Evidence-backed note",
                subject: "Update",
                metricOverride: "revenue_kes",
                valueOverride: 5000,
                fromAddress: "alice@test.example",
                toAddress: "kijani@agent.juakali.demo",
                source: "email_paste",
                steps: evidenceSteps(),
                approvedSummary,
                correlationId: "approved-summary-test",
                pipeline: {
                    kpiResolved: true,
                    kpiMetric: "revenue_kes",
                    kpiValue: 5000,
                    kpiBefore: 0,
                    kpiAfter: 5000,
                },
                result: null,
                error: null,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            })
        );

        const run = await t.run(async (ctx) => ctx.db.get(runId));
        expect(publishedSummaryForRun(run!, "Kijani Foods")).toBe(approvedSummary);
    });

    test("run details are visible only to the owning investor", async () => {
        const t = makeTest();
        const alice = await createUser(t, "alice@test.example");
        const bob = await createUser(t, "bob@test.example");
        const { ventureId, investorId, commitmentId } = await createDeal(t, alice.userId);
        const runId = await t.run(async (ctx) =>
            ctx.db.insert("agentRuns", {
                commitmentId,
                ventureId,
                investorId,
                status: "failed",
                trigger: "approved_note",
                noteBody: "Private note",
                subject: "Private run",
                fromAddress: "alice@test.example",
                toAddress: "kijani@agent.juakali.demo",
                source: "email_paste",
                steps: evidenceSteps(),
                result: null,
                error: "Private failure",
                createdAt: Date.now(),
                updatedAt: Date.now(),
            })
        );

        expect(await t.query(api.agentRuns.getAgentRun, { runId })).toBeNull();
        expect(await bob.asUser.query(api.agentRuns.getAgentRun, { runId })).toBeNull();
        expect((await alice.asUser.query(api.agentRuns.getAgentRun, { runId }))?.noteBody).toBe("Private note");
    });

    test("retry resumes the first uncommitted step without changing run lineage", async () => {
        const t = makeTest();
        const alice = await createUser(t, "alice@test.example");
        const { ventureId, investorId, commitmentId } = await createDeal(t, alice.userId);
        const actionPlan = buildProactiveActionPlan({
            ventureName: "Kijani Foods",
            daysStale: 3,
            metricLabel: "Revenue",
            lastCheckInAt: null,
        });
        const runId = await t.run(async (ctx) => {
            const checkInId = await ctx.db.insert("kpiCheckIns", {
                ventureId,
                commitmentId,
                periodLabel: "Test",
                metric: "revenue_kes",
                value: 2000,
                note: "Existing effect",
                source: "email_paste",
                createdAt: Date.now(),
            });
            return ctx.db.insert("agentRuns", {
                commitmentId,
                ventureId,
                investorId,
                status: "failed",
                trigger: "approved_note",
                noteBody: "Retry me",
                subject: "Retry",
                fromAddress: "alice@test.example",
                toAddress: "kijani@agent.juakali.demo",
                source: "email_paste",
                steps: evidenceSteps().map((step, index) =>
                    index === 2 ? { ...step, status: "failed" as const, detail: "Ledger unavailable" } : step
                ),
                actionPlan,
                approvedSummary: "Keep this exact summary",
                correlationId: "stable-correlation",
                pipeline: {
                    checkInId,
                    kpiResolved: true,
                    kpiMetric: "revenue_kes",
                    kpiValue: 2000,
                    kpiBefore: 0,
                    kpiAfter: 2000,
                },
                result: null,
                error: "Ledger unavailable",
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });
        });

        const state = await t.run(async (ctx) => ctx.db.get(runId));
        const retry = retryStateForRun(state!);
        expect(retry?.resumeTool).toBe("post_public_ledger");
        expect(retry?.steps[2]?.status).toBe("running");
        expect(retry?.steps[3]?.status).toBe("done");
        expect(state?.correlationId).toBe("stable-correlation");
        expect(state?.actionPlan?.reason.whyNow).toBe(actionPlan.reason.whyNow);
        expect(state?.approvedSummary).toBe("Keep this exact summary");
    });
});
