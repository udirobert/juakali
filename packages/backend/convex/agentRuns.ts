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
    return [primary, "agent"];
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
        trigger: "approved_note" | "inbound_email";
        fromAddressOverride?: string;
        toAddressOverride?: string;
        source: "agent" | "sms" | "manual" | "email_paste";
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
            status: v.union(v.literal("running"), v.literal("completed"), v.literal("failed")),
            trigger: v.union(v.literal("approved_note"), v.literal("inbound_email")),
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
            status: v.union(v.literal("running"), v.literal("completed"), v.literal("failed")),
            trigger: v.union(v.literal("approved_note"), v.literal("inbound_email")),
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

            const checkInId = await ctx.db.insert("kpiCheckIns", {
                ventureId: venture._id,
                commitmentId: run.commitmentId,
                periodLabel: `Email · ${new Date(now).toISOString().slice(0, 10)}`,
                metric,
                value,
                note: run.noteBody.slice(0, 160),
                source: run.source,
                createdAt: now,
            });

            await writeLedgerEvent(ctx, {
                type: "checkin",
                ventureId: venture._id,
                commitmentId: run.commitmentId,
                summary: `${venture.name}: ${metric} = ${value} (from investor email)`,
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
            const digestSummary = `Acted on your email for ${venture.name}: logged ${args.kpiMetric}=${args.kpiValue}.`;
            const digestInsights =
                venture.peerMedian != null
                    ? `Peer median this period is ~${venture.peerMedian}. Next digest ${cadence}.`
                    : `Next digest ${cadence}.`;
            const nextAction = `Watch ${venture.name} through Friday — digest cadence: ${cadence}.`;

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
                summary: `Investor digest for ${venture.name}: ${digestSummary}`,
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
                summary: `Agent run: approved note → KPI ${args.kpiMetric} +${args.kpiValue}, digest, and reply for ${venture.name}.`,
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
            const replySummary = `Acted on your email for ${venture.name}: logged ${args.kpiMetric}=${args.kpiValue} (total now ${args.kpiAfter}).`;
            const peerLine =
                venture.peerMedian != null
                    ? `Peer median this period is ~${venture.peerMedian}.`
                    : null;
            const replyBody = [
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
