import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { rateLimiter } from "./rateLimit";
import { assertCanAct } from "./softAuth";

/**
 * Durable "approve & run" pipeline.
 *
 * One committed transaction per agent step, so the UI streams truthful
 * progress (subscribers see each real commit — nothing simulated):
 *
 *   0. createAgentRun             → run + inbound email row; step 1 "running"
 *   1. stepRecordKpi (internal)   → kpiCheckIns + ledger event; step done
 *   2. stepWriteDigest (internal) → agentDigests + ledger event; step done
 *   3. stepPostLedger (internal)  → ledger "action" event (public proof)
 *   4. stepSendReply (internal)   → outbound reply + cadence patch; run completed
 *
 * A failed step marks the run failed and stops the chain (nothing is
 * scheduled after a failure). Inbound AgentMail uses the same entry point,
 * so email-triggered runs stream live in the cockpit too.
 *
 * Recovery: crons.ts sweeps runs stuck "running" for >90s and fails them.
 */

export const runStepValidator = v.object({
    tool: v.string(),
    label: v.string(),
    status: v.union(
        v.literal("pending"),
        v.literal("running"),
        v.literal("done"),
        v.literal("failed")
    ),
    detail: v.union(v.string(), v.null()),
});

export const RUN_STEP_ORDER = [
    { tool: "log_kpi_checkin", label: "Log KPI" },
    { tool: "create_investor_digest", label: "Write digest" },
    { tool: "post_public_ledger", label: "Post to ledger" },
    { tool: "send_reply", label: "Send reply" },
] as const;

export const runResultValidator = v.object({
    checkInId: v.id("kpiCheckIns"),
    digestId: v.id("agentDigests"),
    replyId: v.id("agentEmails"),
    message: v.string(),
    kpiMetric: v.string(),
    kpiValue: v.number(),
    kpiBefore: v.number(),
    kpiAfter: v.number(),
    replyTo: v.string(),
});

export const runStatusValidator = v.union(
    v.literal("proposed"),
    v.literal("running"),
    v.literal("completed"),
    v.literal("failed"),
    v.literal("dismissed")
);

export const runTriggerValidator = v.union(
    v.literal("approved_note"),
    v.literal("inbound_email"),
    v.literal("proactive"),
    v.literal("entrepreneur_note")
);

/** All-pending steps for a proposal (nothing runs until approval). */
function proposalSteps(): Array<{
    tool: string;
    label: string;
    status: "pending";
    detail: null;
}> {
    return RUN_STEP_ORDER.map((step) => ({
        tool: step.tool,
        label: step.label,
        status: "pending" as const,
        detail: null,
    }));
}

function initialSteps(): Array<{
    tool: string;
    label: string;
    status: "running" | "pending";
    detail: null;
}> {
    return RUN_STEP_ORDER.map((step, i) => ({
        tool: step.tool,
        label: step.label,
        status: i === 0 ? ("running" as const) : ("pending" as const),
        detail: null,
    }));
}

function nextFridayEightEAT(fromMs: number = Date.now()) {
    const d = new Date(fromMs);
    const day = d.getUTCDay();
    const daysUntilFri = (5 - day + 7) % 7 || 7;
    const next = new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + daysUntilFri, 5, 0, 0)
    );
    return next.getTime();
}

async function writeLedgerEvent(
    ctx: MutationCtx,
    args: {
        type: "checkin" | "digest" | "action";
        ventureId: Id<"ventures">;
        commitmentId: Id<"commitments">;
        summary: string;
        metric?: string | null;
        value?: number | null;
        evidence?: string[];
        createdAt: number;
    }
) {
    return await ctx.db.insert("ledgerEvents", {
        type: args.type,
        ventureId: args.ventureId,
        commitmentId: args.commitmentId,
        summary: args.summary,
        amountKes: null,
        metric: args.metric ?? null,
        value: args.value ?? null,
        evidence: args.evidence,
        createdAt: args.createdAt,
        publicVisible: true,
    });
}

function evidenceTags(run: Doc<"agentRuns">): string[] {
    const primary = run.source === "email_paste" ? "email" : run.source;
    const tags = run.trigger === "proactive" ? ["proactive", primary] : [primary];
    return Array.from(new Set([...tags, "agent"]));
}

/** First-person origin line for ledger/digest/reply copy. */
function originPhrase(run: Doc<"agentRuns">): string {
    switch (run.trigger) {
        case "inbound_email":
            return "your email";
        case "proactive":
            return "my check-in";
        case "entrepreneur_note":
            return "the founder's update";
        default:
            return "your approved note";
    }
}

function resolveKpi(run: Doc<"agentRuns">, kpiUnit: "meetings" | "revenue_kes" | "jobs") {
    const metric =
        run.metricOverride?.trim() ||
        (kpiUnit === "meetings"
            ? "meetings_booked"
            : kpiUnit === "jobs"
              ? "jobs_completed"
              : "revenue_kes");
    const value =
        run.valueOverride ?? (kpiUnit === "revenue_kes" ? 3500 : kpiUnit === "jobs" ? 1 : 2);
    return { metric, value };
}

/** Commit step bookkeeping: this step done, next step running. */
async function advanceRun(
    ctx: MutationCtx,
    run: Doc<"agentRuns">,
    tool: string,
    detail: string | null
) {
    const idx = RUN_STEP_ORDER.findIndex((s) => s.tool === tool);
    const steps = run.steps.map((step, i) => {
        if (i === idx) return { ...step, status: "done" as const, detail };
        if (i === idx + 1 && step.status === "pending") {
            return { ...step, status: "running" as const, detail: null };
        }
        return step;
    });
    await ctx.db.patch(run._id, { steps, updatedAt: Date.now() });
}

/** Stop the chain: current step failed, remaining steps marked failed. */
async function failRunInline(
    ctx: MutationCtx,
    run: Doc<"agentRuns">,
    tool: string,
    error: string
) {
    const steps = run.steps.map((step) => {
        if (step.tool === tool) return { ...step, status: "failed" as const, detail: error };
        if (step.status === "pending" || step.status === "running") {
            return { ...step, status: "failed" as const, detail: "Skipped — earlier step failed" };
        }
        return step;
    });
    await ctx.db.patch(run._id, { status: "failed", steps, error, updatedAt: Date.now() });
}

/**
 * Shared run creation (mutations cannot call mutations in Convex, so both
 * the public approve mutation and invest.ts's inbound webhook use this).
 */
export async function createAgentRun(
    ctx: MutationCtx,
    args: {
        commitmentId: Id<"commitments">;
        noteBody: string;
        subject?: string;
        metric?: string | null;
        value?: number | null;
        trigger: "approved_note" | "inbound_email" | "entrepreneur_note";
        fromAddressOverride?: string;
        toAddressOverride?: string;
        source: "agent" | "sms" | "manual" | "email_paste" | "self";
    }
) {
    const body = args.noteBody.trim();
    if (body.length === 0) throw new Error("Email body is required");

    const commitment = await ctx.db.get(args.commitmentId);
    if (!commitment) throw new Error("Commitment not found");
    const venture = await ctx.db.get(commitment.ventureId);
    if (!venture) throw new Error("Venture not found");
    const investor = await ctx.db.get(commitment.investorId);
    if (!investor) throw new Error("Investor not found");

    const now = Date.now();
    const fromAddress = args.fromAddressOverride ?? investor.email ?? "investor@example.com";
    const toAddress =
        args.toAddressOverride ?? venture.agentEmail ?? `${venture.publicSlug}@agent.juakali.demo`;
    const subject = args.subject?.trim() || `Re: ${venture.name}`;

    await ctx.db.insert("agentEmails", {
        commitmentId: commitment._id,
        ventureId: venture._id,
        investorId: investor._id,
        direction: "inbound",
        fromAddress,
        toAddress,
        subject,
        body,
        createdAt: now,
    });

    const runId = await ctx.db.insert("agentRuns", {
        commitmentId: commitment._id,
        ventureId: venture._id,
        investorId: investor._id,
        status: "running",
        trigger: args.trigger,
        noteBody: body,
        subject,
        metricOverride: args.metric ?? null,
        valueOverride: args.value ?? null,
        fromAddress,
        toAddress,
        source: args.source,
        steps: initialSteps(),
        result: null,
        error: null,
        createdAt: now,
        updatedAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.agentRuns.stepRecordKpi, { runId });

    return { runId, commitmentId: commitment._id, ventureId: venture._id };
}

/** Approve & run from the cockpit (the human-approved path). */
export const startAgentRun = mutation({
    args: {
        commitmentId: v.id("commitments"),
        noteBody: v.string(),
        subject: v.optional(v.string()),
        metric: v.optional(v.string()),
        value: v.optional(v.number()),
    },
    returns: v.object({
        runId: v.id("agentRuns"),
        commitmentId: v.id("commitments"),
        ventureId: v.id("ventures"),
    }),
    handler: async (ctx, args) => {
        await assertCanAct(ctx);
        await rateLimiter.limit(ctx, "investMutate", { key: "agentRun" });
        return await createAgentRun(ctx, {
            commitmentId: args.commitmentId,
            noteBody: args.noteBody,
            subject: args.subject,
            metric: args.metric,
            value: args.value,
            trigger: "approved_note",
            source: "email_paste",
        });
    },
});

export const getAgentRun = query({
    args: { runId: v.id("agentRuns") },
    returns: v.union(
        v.object({
            id: v.id("agentRuns"),
            commitmentId: v.id("commitments"),
            ventureId: v.id("ventures"),
            status: runStatusValidator,
            trigger: runTriggerValidator,
            noteBody: v.string(),
            subject: v.string(),
            fromAddress: v.string(),
            toAddress: v.string(),
            steps: v.array(runStepValidator),
            result: v.union(runResultValidator, v.null()),
            error: v.union(v.string(), v.null()),
            createdAt: v.number(),
            updatedAt: v.number(),
        }),
        v.null()
    ),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        if (!run) return null;
        return {
            id: run._id,
            commitmentId: run.commitmentId,
            ventureId: run.ventureId,
            status: run.status,
            trigger: run.trigger,
            noteBody: run.noteBody,
            subject: run.subject,
            fromAddress: run.fromAddress,
            toAddress: run.toAddress,
            steps: run.steps,
            result: run.result ?? null,
            error: run.error ?? null,
            createdAt: run.createdAt,
            updatedAt: run.updatedAt,
        };
    },
});

/** Latest run for a commitment — lets the cockpit react to inbound email runs too. */
export const getLatestRun = query({
    args: { commitmentId: v.id("commitments") },
    returns: v.union(
        v.object({
            id: v.id("agentRuns"),
            status: runStatusValidator,
            trigger: runTriggerValidator,
            createdAt: v.number(),
        }),
        v.null()
    ),
    handler: async (ctx, args) => {
        const latest = await ctx.db
            .query("agentRuns")
            .withIndex("by_commitmentId", (q) => q.eq("commitmentId", args.commitmentId))
            .order("desc")
            .first();
        return latest
            ? {
                  id: latest._id,
                  status: latest.status,
                  trigger: latest.trigger,
                  createdAt: latest.createdAt,
              }
            : null;
    },
});

// --- Step executors (internal; one transaction each, scheduled in order) ---

export const stepRecordKpi = internalMutation({
    args: { runId: v.id("agentRuns") },
    returns: v.object({ ok: v.boolean() }),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        if (!run || run.status !== "running") return { ok: false };

        try {
            const venture = await ctx.db.get(run.ventureId);
            if (!venture) throw new Error("Venture not found");

            const now = Date.now();
            const { metric, value } = resolveKpi(run, venture.kpiUnit);

            const checkInsBefore = await ctx.db
                .query("kpiCheckIns")
                .withIndex("by_ventureId", (q) => q.eq("ventureId", venture._id))
                .take(200);
            const kpiBefore = checkInsBefore.reduce((sum, row) => sum + row.value, 0);

            // Outcome linkage: if the venture carries recently-applied mentor
            // wisdom, this check-in measures it.
            const appliedWisdom = await ctx.db
                .query("sharedItems")
                .withIndex("by_ventureId_and_status", (q) =>
                    q.eq("ventureId", venture._id).eq("status", "applied")
                )
                .order("desc")
                .first();
            const appliedItemId =
                appliedWisdom && appliedWisdom.appliedAt != null && now - appliedWisdom.appliedAt < 45 * 24 * 3600 * 1000
                    ? appliedWisdom._id
                    : null;

            const checkInId = await ctx.db.insert("kpiCheckIns", {
                ventureId: venture._id,
                commitmentId: run.commitmentId,
                periodLabel: `Email · ${new Date(now).toISOString().slice(0, 10)}`,
                metric,
                value,
                note: run.noteBody.slice(0, 160),
                source: run.source,
                appliedItemId,
                createdAt: now,
            });

            await writeLedgerEvent(ctx, {
                type: "checkin",
                ventureId: venture._id,
                commitmentId: run.commitmentId,
                summary: `${venture.name}: ${metric} = ${value} — Jua logged this from ${originPhrase(run)}`,
                metric,
                value,
                evidence: evidenceTags(run),
                createdAt: now,
            });

            await advanceRun(ctx, run, "log_kpi_checkin", `${metric} = ${value}`);

            await ctx.scheduler.runAfter(0, internal.agentRuns.stepWriteDigest, {
                runId: run._id,
                checkInId,
                kpiBefore,
                kpiAfter: kpiBefore + value,
                kpiMetric: metric,
                kpiValue: value,
            });
            return { ok: true };
        } catch (e) {
            const error = e instanceof Error ? e.message : "KPI step failed";
            await failRunInline(ctx, run, "log_kpi_checkin", error);
            return { ok: false };
        }
    },
});

export const stepWriteDigest = internalMutation({
    args: {
        runId: v.id("agentRuns"),
        checkInId: v.id("kpiCheckIns"),
        kpiBefore: v.number(),
        kpiAfter: v.number(),
        kpiMetric: v.string(),
        kpiValue: v.number(),
    },
    returns: v.object({ ok: v.boolean() }),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        if (!run || run.status !== "running") return { ok: false };

        try {
            const venture = await ctx.db.get(run.ventureId);
            const commitment = await ctx.db.get(run.commitmentId);
            if (!venture || !commitment) throw new Error("Venture or commitment missing");

            const now = Date.now();
            const cadence = commitment.digestCadence ?? "Weekly · Fri 08:00 EAT";
            const digestSummary = `I acted on ${originPhrase(run)} for ${venture.name}: logged ${args.kpiMetric} = ${args.kpiValue}.`;
            const digestInsights =
                venture.peerMedian != null
                    ? `Peer median this period is ~${venture.peerMedian}. Next digest ${cadence}.`
                    : `Next digest ${cadence}.`;
            const nextAction = `I'll keep watching ${venture.name} through Friday — digest cadence: ${cadence}.`;

            const digestId = await ctx.db.insert("agentDigests", {
                commitmentId: run.commitmentId,
                ventureId: venture._id,
                summary: digestSummary,
                insights: digestInsights,
                nextAction,
                evidence: evidenceTags(run),
                createdAt: now,
            });

            await writeLedgerEvent(ctx, {
                type: "digest",
                ventureId: venture._id,
                commitmentId: run.commitmentId,
                summary: `Digest for ${venture.name}: ${digestSummary}`,
                evidence: evidenceTags(run),
                createdAt: now,
            });

            await advanceRun(ctx, run, "create_investor_digest", digestSummary);

            await ctx.scheduler.runAfter(0, internal.agentRuns.stepPostLedger, {
                runId: run._id,
                checkInId: args.checkInId,
                digestId,
                kpiBefore: args.kpiBefore,
                kpiAfter: args.kpiAfter,
                kpiMetric: args.kpiMetric,
                kpiValue: args.kpiValue,
            });
            return { ok: true };
        } catch (e) {
            const error = e instanceof Error ? e.message : "Digest step failed";
            await failRunInline(ctx, run, "create_investor_digest", error);
            return { ok: false };
        }
    },
});

export const stepPostLedger = internalMutation({
    args: {
        runId: v.id("agentRuns"),
        checkInId: v.id("kpiCheckIns"),
        digestId: v.id("agentDigests"),
        kpiBefore: v.number(),
        kpiAfter: v.number(),
        kpiMetric: v.string(),
        kpiValue: v.number(),
    },
    returns: v.object({ ok: v.boolean() }),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        if (!run || run.status !== "running") return { ok: false };

        try {
            const venture = await ctx.db.get(run.ventureId);
            if (!venture) throw new Error("Venture not found");

            const now = Date.now();
            await writeLedgerEvent(ctx, {
                type: "action",
                ventureId: venture._id,
                commitmentId: run.commitmentId,
                summary: `Jua ran ${originPhrase(run)} for ${venture.name}: KPI ${args.kpiMetric} +${args.kpiValue}, digest filed, ledger posted.`,
                evidence: evidenceTags(run),
                createdAt: now,
            });

            await advanceRun(ctx, run, "post_public_ledger", "checkin + digest + action events");

            await ctx.scheduler.runAfter(0, internal.agentRuns.stepSendReply, {
                runId: run._id,
                checkInId: args.checkInId,
                digestId: args.digestId,
                kpiBefore: args.kpiBefore,
                kpiAfter: args.kpiAfter,
                kpiMetric: args.kpiMetric,
                kpiValue: args.kpiValue,
            });
            return { ok: true };
        } catch (e) {
            const error = e instanceof Error ? e.message : "Ledger step failed";
            await failRunInline(ctx, run, "post_public_ledger", error);
            return { ok: false };
        }
    },
});

export const stepSendReply = internalMutation({
    args: {
        runId: v.id("agentRuns"),
        checkInId: v.id("kpiCheckIns"),
        digestId: v.id("agentDigests"),
        kpiBefore: v.number(),
        kpiAfter: v.number(),
        kpiMetric: v.string(),
        kpiValue: v.number(),
    },
    returns: v.object({ ok: v.boolean() }),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        if (!run || run.status !== "running") return { ok: false };

        try {
            const venture = await ctx.db.get(run.ventureId);
            const commitment = await ctx.db.get(run.commitmentId);
            if (!venture || !commitment) throw new Error("Venture or commitment missing");

            const now = Date.now();
            const noteEcho = run.trigger === "proactive" ? null : `You said: “${run.noteBody.slice(0, 140)}”`;
            const replySummary = `I acted on ${originPhrase(run)} for ${venture.name}: logged ${args.kpiMetric} = ${args.kpiValue} (total now ${args.kpiAfter}).`;
            const peerLine =
                venture.peerMedian != null
                    ? `Peer median this period is ~${venture.peerMedian}.`
                    : null;
            const replyBody = [
                noteEcho,
                replySummary,
                peerLine,
                `Evidence tagged: ${run.source}. Posted to the public ledger.`,
                "— Jua · JuaKali agent",
            ]
                .filter(Boolean)
                .join("\n\n");

            const replyId = await ctx.db.insert("agentEmails", {
                commitmentId: run.commitmentId,
                ventureId: venture._id,
                investorId: run.investorId,
                direction: "outbound",
                fromAddress: run.toAddress,
                toAddress: run.fromAddress,
                subject: `Re: ${run.subject.replace(/^Re:\s*/i, "")}`,
                body: replyBody,
                createdAt: now,
            });

            await ctx.db.patch(commitment._id, {
                nextDigestAt: nextFridayEightEAT(now),
                digestCadence: commitment.digestCadence ?? "Weekly · Fri 08:00 EAT",
                updatedAt: now,
            });

            const message = `Agent replied and logged ${args.kpiMetric}=${args.kpiValue} for ${venture.name}.`;
            const idx = RUN_STEP_ORDER.length - 1;
            const steps = run.steps.map((step, i) =>
                i === idx
                    ? { ...step, status: "done" as const, detail: `to ${run.fromAddress}` }
                    : step
            );
            await ctx.db.patch(run._id, {
                status: "completed",
                steps,
                result: {
                    checkInId: args.checkInId,
                    digestId: args.digestId,
                    replyId,
                    message,
                    kpiMetric: args.kpiMetric,
                    kpiValue: args.kpiValue,
                    kpiBefore: args.kpiBefore,
                    kpiAfter: args.kpiAfter,
                    replyTo: run.fromAddress,
                },
                updatedAt: Date.now(),
            });
            return { ok: true };
        } catch (e) {
            const error = e instanceof Error ? e.message : "Reply step failed";
            await failRunInline(ctx, run, "send_reply", error);
            return { ok: false };
        }
    },
});

/** Cron recovery: fail runs stuck "running" past the cutoff (dropped schedule). */
export const recoverStaleRuns = internalMutation({
    args: { olderThanMs: v.number() },
    returns: v.object({ failed: v.number() }),
    handler: async (ctx, args) => {
        const stuck = await ctx.db
            .query("agentRuns")
            .withIndex("by_status", (q) => q.eq("status", "running"))
            .take(50);
        let failed = 0;
        const cutoff = Date.now() - args.olderThanMs;
        for (const run of stuck) {
            if (run.updatedAt >= cutoff) continue;
            const lastRunning = run.steps.find(
                (step) => step.status === "running" || step.status === "pending"
            );
            if (lastRunning) {
                await failRunInline(
                    ctx,
                    run,
                    lastRunning.tool,
                    "Timed out — run recovered by background sweep"
                );
            } else {
                await ctx.db.patch(run._id, {
                    status: "failed",
                    error: "Timed out — run recovered by background sweep",
                    updatedAt: Date.now(),
                });
            }
            failed++;
        }
        return { failed };
    },
});

// --- Proactive proposals: Jua suggests work, nothing runs until approval ---

/** How stale a venture's latest KPI may be before Jua proposes a check-in. */
const PROPOSAL_STALE_MS = 24 * 60 * 60 * 1000; // 24h — demo-friendly cadence

function proposalNote(ventureName: string, daysStale: number, metricLabel: string): string {
    const age = daysStale <= 0 ? "just" : `${daysStale} day${daysStale === 1 ? "" : "s"} ago`;
    return [
        `${ventureName} hasn't reported in ${age} — the latest ${metricLabel} on file is getting stale.`,
        "I want to follow up, log the result as a KPI check-in, write you a digest, and post it to the public ledger.",
        "Approve and I'll get to work; dismiss if now is not the time.",
    ].join("\n");
}

/**
 * Insert a `proposed` run for one commitment (shared by the proactive cron
 * and the demo seeder). Pure initiative — nothing runs until approval.
 */
export async function createProposalForCommitment(
    ctx: MutationCtx,
    commitment: Doc<"commitments">,
    venture: Doc<"ventures">,
    daysStale: number
) {
    const now = Date.now();
    const noteBody = proposalNote(venture.name, daysStale, venture.kpiLabel || "KPI");
    return await ctx.db.insert("agentRuns", {
        commitmentId: commitment._id,
        ventureId: venture._id,
        investorId: commitment.investorId,
        status: "proposed",
        trigger: "proactive",
        noteBody,
        subject: `Check-in: ${venture.name}`,
        metricOverride: null,
        valueOverride: null,
        fromAddress: "jua@agent.juakali.demo",
        toAddress: venture.agentEmail ?? `${venture.publicSlug}@agent.juakali.demo`,
        source: "agent",
        steps: proposalSteps(),
        result: null,
        error: null,
        createdAt: now,
        updatedAt: now,
    });
}

/**
 * Cron: create at most ONE pending proposal per commitment when its venture's
 * latest KPI check-in is older than PROPOSAL_STALE_MS. Pure initiative — no
 * data is logged until the investor approves.
 */
export const proposeProactiveCheckIns = internalMutation({
    args: {},
    returns: v.object({ proposed: v.number(), skipped: v.number() }),
    handler: async (ctx) => {
        const commitments = await ctx.db.query("commitments").order("desc").take(60);
        const now = Date.now();
        let proposed = 0;
        let skipped = 0;

        for (const commitment of commitments) {
            if (commitment.status === "written_off") {
                skipped++;
                continue;
            }
            // One open proposal per commitment (bounded scan; proposals are rare).
            const recentRuns = await ctx.db
                .query("agentRuns")
                .withIndex("by_commitmentId", (q) => q.eq("commitmentId", commitment._id))
                .order("desc")
                .take(20);
            if (recentRuns.some((run) => run.status === "proposed")) {
                skipped++;
                continue;
            }

            const venture = await ctx.db.get(commitment.ventureId);
            if (!venture || venture.status !== "active") {
                skipped++;
                continue;
            }
            const lastCheckIn = await ctx.db
                .query("kpiCheckIns")
                .withIndex("by_ventureId", (q) => q.eq("ventureId", venture._id))
                .order("desc")
                .first();
            const lastActivityAt = lastCheckIn?.createdAt ?? commitment.createdAt;
            const staleMs = now - lastActivityAt;
            if (staleMs < PROPOSAL_STALE_MS) {
                skipped++;
                continue;
            }
            // Don't re-propose within the same staleness window as the last run.
            const lastRun = await ctx.db
                .query("agentRuns")
                .withIndex("by_commitmentId", (q) => q.eq("commitmentId", commitment._id))
                .order("desc")
                .first();
            if (lastRun && lastRun.status !== "dismissed" && now - lastRun.createdAt < PROPOSAL_STALE_MS) {
                skipped++;
                continue;
            }

            await createProposalForCommitment(
                ctx,
                commitment,
                venture,
                Math.floor(staleMs / (24 * 60 * 60 * 1000))
            );
            proposed++;
        }

        return { proposed, skipped };
    },
});

/** Open proposal for a commitment (at most one exists; null if none). */
export const getOpenProposal = query({
    args: { commitmentId: v.id("commitments") },
    returns: v.union(
        v.object({
            id: v.id("agentRuns"),
            noteBody: v.string(),
            subject: v.string(),
            steps: v.array(runStepValidator),
            createdAt: v.number(),
        }),
        v.null()
    ),
    handler: async (ctx, args) => {
        // Bounded scan + JS check instead of a DB filter (proposals are capped
        // at 1 per commitment, so this stays short).
        const recentRuns = await ctx.db
            .query("agentRuns")
            .withIndex("by_commitmentId", (q) => q.eq("commitmentId", args.commitmentId))
            .order("desc")
            .take(20);
        const proposal = recentRuns.find((run) => run.status === "proposed");
        if (!proposal) return null;
        return {
            id: proposal._id,
            noteBody: proposal.noteBody,
            subject: proposal.subject,
            steps: proposal.steps,
            createdAt: proposal.createdAt,
        };
    },
});

/** Approve a proposal → same durable pipeline as an approved note. */
export const approveProposal = mutation({
    args: { runId: v.id("agentRuns") },
    returns: v.object({
        runId: v.id("agentRuns"),
        commitmentId: v.id("commitments"),
        ventureId: v.id("ventures"),
    }),
    handler: async (ctx, args) => {
        await assertCanAct(ctx);
        await rateLimiter.limit(ctx, "investMutate", { key: "agentRun" });
        const run = await ctx.db.get(args.runId);
        if (!run) throw new Error("Proposal not found");
        if (run.status !== "proposed") throw new Error("Proposal is no longer pending");

        const now = Date.now();
        const steps = run.steps.map((step, i) =>
            i === 0 ? { ...step, status: "running" as const, detail: null } : step
        );
        await ctx.db.patch(run._id, { status: "running", steps, updatedAt: now });
        await ctx.scheduler.runAfter(0, internal.agentRuns.stepRecordKpi, { runId: run._id });
        return { runId: run._id, commitmentId: run.commitmentId, ventureId: run.ventureId };
    },
});

/** Dismiss a proposal — Jua takes note and won't re-propose immediately. */
export const dismissProposal = mutation({
    args: { runId: v.id("agentRuns") },
    returns: v.object({ ok: v.boolean() }),
    handler: async (ctx, args) => {
        await assertCanAct(ctx);
        const run = await ctx.db.get(args.runId);
        if (!run || run.status !== "proposed") return { ok: false };
        await ctx.db.patch(run._id, { status: "dismissed", updatedAt: Date.now() });
        return { ok: true };
    },
});
