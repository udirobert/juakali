import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { rateLimiter } from "./rateLimit";
import {
    assertCanAct,
    assertInvestorOwnsCommitment,
    assertInvestorOwnsRun,
    canReadInvestorRun,
} from "./softAuth";
import {
    actionPlanValidator,
    actionPlanViewValidator,
    buildProactiveActionPlan,
    type AutonomyLevel,
} from "./actionPlan";
import { syncInvestorBriefing } from "./investorBriefing";

/**
 * Durable "approve & run" pipeline.
 *
 * One committed transaction per agent step, so the UI streams truthful
 * progress (subscribers see each real commit — nothing simulated):
 *
 *   Evidence-backed runs (approved note / inbound email / founder note):
 *     0. createAgentRun             → run + inbound email row; step 1 "running"
 *     1. stepRecordKpi (internal)   → kpiCheckIns + ledger event (ONLY if the
 *                                     run carries sourced evidence — never a
 *                                     fabricated fallback); step done
 *     2. stepWriteDigest (internal) → agentDigests + ledger event; step done
 *     3. stepPostLedger (internal)  → ledger "action" event (public proof,
 *                                     publishing the approved summary verbatim)
 *     4. stepSendReply (internal)   → outbound reply + cadence patch; run completed
 *
 *   Proactive check-ins (request evidence first, record nothing until it arrives):
 *     0. approveProposal            → run "running"; step 1 "running"
 *     1. stepSendFounderRequest     → outbound request + PRIVATE ledger event;
 *                                     run parks in "waiting_for_response"
 *     2. submitFounderEvidence      → sourced KPI stamped on the run; resumes
 *     3. stepRecordKpi → stepWriteDigest → stepPostLedger → stepSendReply
 *
 * Every step executor is idempotent (guarded by run.pipeline), so a failed run
 * can be retried from its first uncommitted step without duplicating effects.
 *
 * A failed step marks the run failed and stops the chain (nothing is
 * scheduled after a failure). Inbound AgentMail uses the same entry point,
 * so email-triggered runs stream live in the cockpit too.
 *
 * Recovery: crons.ts sweeps runs stuck "running" for >90s and fails them.
 * Runs parked "waiting_for_response" are exempt — they wait for evidence.
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

/**
 * Proactive runs follow a different pipeline: the approval authorizes a
 * check-in REQUEST, not KPI recording. KPI is only recorded once the founder
 * responds with sourced evidence (see submitFounderEvidence).
 */
export const PROACTIVE_RUN_STEP_ORDER = [
    { tool: "send_founder_request", label: "Request check-in" },
    { tool: "log_kpi_checkin", label: "Log KPI" },
    { tool: "create_investor_digest", label: "Write digest" },
    { tool: "post_public_ledger", label: "Post to ledger" },
    { tool: "send_reply", label: "Send reply" },
] as const;

export const runResultValidator = v.object({
    checkInId: v.union(v.id("kpiCheckIns"), v.null()),
    digestId: v.union(v.id("agentDigests"), v.null()),
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
    v.literal("waiting_for_response"),
    v.literal("awaiting_publication"),
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
    return PROACTIVE_RUN_STEP_ORDER.map((step) => ({
        tool: step.tool,
        label: step.label,
        status: "pending" as const,
        detail: null,
    }));
}

/** The step order a run follows — proactive runs request evidence first. */
function stepOrderFor(run: Doc<"agentRuns">): ReadonlyArray<{ tool: string; label: string }> {
    return run.trigger === "proactive" ? PROACTIVE_RUN_STEP_ORDER : RUN_STEP_ORDER;
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
        runId?: Id<"agentRuns">;
        correlationId?: string;
        parentEventId?: Id<"ledgerEvents"> | null;
        initiator?: "investor" | "founder" | "jua" | "system";
        approvalRunId?: Id<"agentRuns"> | null;
        /** Defaults to true; set false for private (investor-only) events. */
        publicVisible?: boolean;
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
        publicVisible: args.publicVisible ?? true,
        runId: args.runId ?? null,
        correlationId: args.correlationId ?? null,
        parentEventId: args.parentEventId ?? null,
        initiator: args.initiator ?? "jua",
        approvalRunId: args.approvalRunId ?? args.runId ?? null,
        correctionOf: null,
        disputeState: "none",
    });
}

function evidenceTags(run: Doc<"agentRuns">): string[] {
    const primary = run.source === "email_paste" ? "email" : run.source;
    const provenance =
        run.evidenceSource === "founder_update"
            ? "founder-update"
            : run.evidenceSource === "investor_entered"
              ? "investor-entered"
              : null;
    const tags = run.trigger === "proactive" ? ["proactive", primary] : [primary];
    return Array.from(new Set([...tags, ...(provenance ? [provenance] : []), "agent"]));
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

/** The exact public copy that the ledger step is authorized to publish. */
export function publishedSummaryForRun(run: Doc<"agentRuns">, ventureName: string): string {
    const kpiMetric = run.pipeline?.kpiMetric ?? null;
    const kpiValue = run.pipeline?.kpiValue ?? null;
    const approved = run.approvedSummary?.trim();
    return approved
        ? approved
        : kpiMetric != null && kpiValue != null
          ? `Jua ran ${originPhrase(run)} for ${ventureName}: KPI ${kpiMetric} +${kpiValue}, digest filed, ledger posted.`
          : `Jua ran ${originPhrase(run)} for ${ventureName}: digest filed, ledger posted.`;
}

function defaultMetricFor(kpiUnit: "meetings" | "revenue_kes" | "jobs") {
    return kpiUnit === "meetings"
        ? "meetings_booked"
        : kpiUnit === "jobs"
          ? "jobs_completed"
          : "revenue_kes";
}

/**
 * Resolve the KPI to record — ONLY from sourced evidence. Approval to request
 * evidence is never approval to invent it, so there is no fabricated fallback:
 * without a real value on the run we record nothing and wait for evidence.
 */
function resolveKpi(
    run: Doc<"agentRuns">,
    kpiUnit: "meetings" | "revenue_kes" | "jobs"
): { metric: string; value: number } | null {
    const metric = run.metricOverride?.trim() || defaultMetricFor(kpiUnit);
    const value = run.valueOverride;
    if (value == null || !Number.isFinite(value)) return null;
    return { metric, value };
}

/** Commit step bookkeeping: this step done, next step running. */
async function advanceRun(
    ctx: MutationCtx,
    run: Doc<"agentRuns">,
    tool: string,
    detail: string | null
) {
    const order = stepOrderFor(run);
    const idx = order.findIndex((s) => s.tool === tool);
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
    // A failed run enters the index's "failed" bucket (blocked stat).
    await syncInvestorBriefing(ctx, run.investorId);
}

/** Map a step tool to its internal executor so steps can be scheduled by name. */
function executorForTool(tool: string) {
    switch (tool) {
        case "send_founder_request":
            return internal.agentRuns.stepSendFounderRequest;
        case "log_kpi_checkin":
            return internal.agentRuns.stepRecordKpi;
        case "create_investor_digest":
            return internal.agentRuns.stepWriteDigest;
        case "post_public_ledger":
            return internal.agentRuns.stepPostLedger;
        case "send_reply":
            return internal.agentRuns.stepSendReply;
        default:
            return null;
    }
}

/**
 * Schedule the step that follows `currentTool` in this run's pipeline. Steps
 * carry only `{ runId }`; each executor reads its inputs from run.pipeline,
 * which is what makes the chain resumable and idempotent on retry.
 */
async function scheduleNextStep(
    ctx: MutationCtx,
    run: Doc<"agentRuns">,
    currentTool: string
) {
    const order = stepOrderFor(run);
    const idx = order.findIndex((s) => s.tool === currentTool);
    const next = idx >= 0 ? order[idx + 1] : undefined;
    if (!next) return;
    const executor = executorForTool(next.tool);
    if (!executor) return;
    await ctx.scheduler.runAfter(0, executor, { runId: run._id });
}

/**
 * Schedule a specific step by tool name (used to resume a failed run from its
 * first uncommitted step). No-op if the tool isn't part of this run's pipeline.
 */
async function scheduleStepByTool(
    ctx: MutationCtx,
    run: Doc<"agentRuns">,
    tool: string
) {
    const executor = executorForTool(tool);
    if (!executor) return;
    await ctx.scheduler.runAfter(0, executor, { runId: run._id });
}

/** The first step that has not committed yet ("pending", "running", or "failed"). */
function firstUncommittedStep(run: Doc<"agentRuns">) {
    return (
        run.steps.find(
            (step) =>
                step.status === "pending" ||
                step.status === "running" ||
                step.status === "failed"
        ) ?? null
    );
}

/**
 * Risk classifier for autonomous work.
 *
 * Under `auto_low_risk`, the ONLY work Jua may start without a fresh approve is
 * sending a private check-in REQUEST to the founder. That action:
 *   - has no public effect (the request ledger event is private),
 *   - does not fabricate or mutate KPI evidence (nothing is recorded),
 *   - stays within a revocable policy (investor can pause or switch levels),
 *   - leaves an audit trail (a private ledger event marks the auto-start).
 *
 * Anything with a public effect — recording a KPI, posting to the public
 * ledger — is NOT low-risk and always requires explicit approval, even after
 * founder evidence arrives on an auto-started run.
 */
export function isLowRiskAutoAction(args: {
    autonomyLevel: AutonomyLevel;
    trigger: "proactive" | "approved_note" | "inbound_email" | "entrepreneur_note";
}): boolean {
    // Only proactive check-in requests qualify; and only under auto_low_risk.
    return args.autonomyLevel === "auto_low_risk" && args.trigger === "proactive";
}

/** Store the immutable evidence record before allowing the KPI step to run. */
async function insertFounderEvidence(
    ctx: MutationCtx,
    args: {
        runId: Id<"agentRuns">;
        ventureId: Id<"ventures">;
        commitmentId: Id<"commitments">;
        metric: string;
        value: number;
        note: string;
        source: "founder_update" | "investor_entered";
        submittedByUserId?: Id<"users"> | null;
    }
): Promise<Id<"founderEvidence">> {
    return await ctx.db.insert("founderEvidence", {
        runId: args.runId,
        ventureId: args.ventureId,
        commitmentId: args.commitmentId,
        metric: args.metric,
        value: args.value,
        note: args.note,
        source: args.source,
        submittedByUserId: args.submittedByUserId ?? null,
        createdAt: Date.now(),
    });
}

/**
 * If a proactive check-in for this venture is parked in `waiting_for_response`,
 * resume it with the founder's sourced evidence instead of starting a new run.
 * Returns the resumed run id, or null if no waiting run exists.
 *
 * This is the founder-side counterpart to submitFounderEvidence: when the
 * founder posts an update carrying a KPI value, it answers Jua's open request.
 */
export async function resumeWaitingRunWithEvidence(
    ctx: MutationCtx,
    args: {
        ventureId: Id<"ventures">;
        /** Optional only when the founder flow has an unambiguous commitment. */
        commitmentId?: Id<"commitments">;
        metric: string | null;
        value: number | null;
        note: string;
        submittedByUserId?: Id<"users"> | null;
    }
): Promise<Id<"agentRuns"> | null> {
    if (args.value == null || !Number.isFinite(args.value) || args.value <= 0) return null;

    const runs = await ctx.db
        .query("agentRuns")
        .withIndex("by_ventureId", (q) => q.eq("ventureId", args.ventureId))
        .order("desc")
        .take(20);
    const waitingRuns = runs.filter(
        (run) =>
            run.status === "waiting_for_response" &&
            (args.commitmentId == null || run.commitmentId === args.commitmentId)
    );
    // Never guess when several investors have an open request for the same
    // venture. A founder update without an explicit commitment must not answer
    // another investor's request.
    if (waitingRuns.length !== 1) return null;
    const waiting = waitingRuns[0]!;

    const now = Date.now();
    const venture = await ctx.db.get(args.ventureId);
    const metric =
        args.metric?.trim() ||
        (venture?.kpiUnit === "meetings"
            ? "meetings_booked"
            : venture?.kpiUnit === "jobs"
              ? "jobs_completed"
              : "revenue_kes");
    const note = args.note.trim() || "Founder evidence";
    const evidenceId = await insertFounderEvidence(ctx, {
        runId: waiting._id,
        ventureId: waiting.ventureId,
        commitmentId: waiting.commitmentId,
        metric,
        value: args.value,
        note,
        source: "founder_update",
        submittedByUserId: args.submittedByUserId,
    });

    // Two-step consent: evidence is recorded on the run but NOTHING is logged
    // or published until the investor approves the exact KPI + public summary.
    // Park the run in awaiting_publication; publishApproval resumes it.
    await ctx.db.patch(waiting._id, {
        status: "awaiting_publication",
        autoStarted: false,
        metricOverride: metric,
        valueOverride: args.value,
        noteBody: note,
        evidenceSource: "founder_update",
        pipeline: { ...waiting.pipeline, evidenceId },
        updatedAt: now,
    });
    // Evidence moves the run into the "decisions" bucket for the second approval.
    await syncInvestorBriefing(ctx, waiting.investorId);
    return waiting._id;
}

/**
 * Shared run creation (mutations cannot call mutations in Convex, so both
 * the public approve mutation and invest.ts's inbound webhook use this).
 */
export async function createAgentRun(    ctx: MutationCtx,
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
        evidenceSource?: "founder_update" | "investor_entered";
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
    const correlationId = `run_${now}_${commitment._id}`;

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
        evidenceSource: args.evidenceSource ?? null,
        steps: initialSteps(),
        actionPlan: undefined,
        correlationId,
        result: null,
        error: null,
        createdAt: now,
        updatedAt: now,
    });

    // A new executing run enters the "active" bucket of the briefing index.
    await syncInvestorBriefing(ctx, investor._id);

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
        await assertInvestorOwnsCommitment(ctx, args.commitmentId);
        await rateLimiter.limit(ctx, "investMutate", { key: "agentRun" });
        const commitment = await ctx.db.get(args.commitmentId);
        if (commitment) {
            const investor = await ctx.db.get(commitment.investorId);
            if (investor?.autonomyLevel === "pause_all") {
                throw new Error("Automation is paused. Change autonomy in Account to run.");
            }
        }
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
            /** The canonical persisted action plan (single source of truth). */
            actionPlan: v.union(actionPlanValidator, v.null()),
            evidenceSource: v.union(
                v.literal("founder_update"),
                v.literal("investor_entered"),
                v.null()
            ),
            approvedSummary: v.union(v.string(), v.null()),
            /** Exact KPI the evidence produced (for the second approval). */
            kpiMetric: v.union(v.string(), v.null()),
            kpiValue: v.union(v.number(), v.null()),
            result: v.union(runResultValidator, v.null()),
            error: v.union(v.string(), v.null()),
            createdAt: v.number(),
            updatedAt: v.number(),
        }),
        v.null()
    ),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        if (!run || !(await canReadInvestorRun(ctx, run))) return null;
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
            actionPlan: run.actionPlan ?? null,
            evidenceSource: run.evidenceSource ?? null,
            approvedSummary: run.approvedSummary ?? null,
            kpiMetric: run.pipeline?.kpiMetric ?? null,
            kpiValue: run.pipeline?.kpiValue ?? run.valueOverride ?? null,
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
        if (latest && !(await canReadInvestorRun(ctx, latest))) return null;
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

/**
 * Proactive step 1: send the founder a check-in REQUEST and park the run in
 * `waiting_for_response`. This step records NO KPI and publishes NO public
 * evidence — approval to request evidence is not approval to invent it. The
 * request itself is a private ledger event (investor-visible, not public).
 * The pipeline resumes only when sourced evidence arrives
 * (see submitFounderEvidence).
 */
export const stepSendFounderRequest = internalMutation({
    args: { runId: v.id("agentRuns") },
    returns: v.object({ ok: v.boolean() }),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        if (!run || run.status !== "running") return { ok: false };

        try {
            // Idempotent: if the request was already sent, just re-park the run.
            if (run.pipeline?.requestEmailId) {
                await ctx.db.patch(run._id, {
                    status: "waiting_for_response",
                    updatedAt: Date.now(),
                });
                await syncInvestorBriefing(ctx, run.investorId);
                return { ok: true };
            }

            const venture = await ctx.db.get(run.ventureId);
            if (!venture) throw new Error("Venture not found");

            const now = Date.now();
            const requestBody =
                run.actionPlan?.preview.messageDraft?.trim() ||
                run.noteBody ||
                `Hi — checking in on ${venture.name}. Please share this week's ${venture.kpiLabel} and what moved.`;

            const requestEmailId = await ctx.db.insert("agentEmails", {
                commitmentId: run.commitmentId,
                ventureId: venture._id,
                investorId: run.investorId,
                direction: "outbound",
                fromAddress: run.fromAddress,
                toAddress: run.toAddress,
                subject: run.subject,
                body: requestBody,
                createdAt: now,
            });

            // Private event: the request is investor-visible, never public proof.
            const requestEventId = await writeLedgerEvent(ctx, {
                type: "action",
                ventureId: venture._id,
                commitmentId: run.commitmentId,
                summary: `Jua requested a check-in from ${venture.name}: "${requestBody.slice(0, 120)}"`,
                evidence: evidenceTags(run),
                createdAt: now,
                runId: run._id,
                correlationId: run.correlationId ?? run._id,
                initiator: "jua",
                approvalRunId: run._id,
                publicVisible: false,
            });

            await ctx.db.patch(run._id, {
                pipeline: { ...run.pipeline, requestEmailId, requestEventId },
                updatedAt: now,
            });

            // Mark the request step done but leave the next step "pending" —
            // the run parks in waiting_for_response and resumes on evidence.
            const order = stepOrderFor(run);
            const reqIdx = order.findIndex((s) => s.tool === "send_founder_request");
            const steps = run.steps.map((step, i) =>
                i === reqIdx
                    ? { ...step, status: "done" as const, detail: `request sent to ${run.toAddress}` }
                    : step
            );
            await ctx.db.patch(run._id, {
                status: "waiting_for_response",
                steps,
                updatedAt: Date.now(),
            });
            await syncInvestorBriefing(ctx, run.investorId);
            return { ok: true };
        } catch (e) {
            const error = e instanceof Error ? e.message : "Request step failed";
            await failRunInline(ctx, run, "send_founder_request", error);
            return { ok: false };
        }
    },
});

/**
 * Record a KPI check-in — ONLY from sourced evidence. If no real value is
 * present on the run, the step completes with a "no evidence" note and the
 * pipeline continues without fabricating a number.
 */
export const stepRecordKpi = internalMutation({
    args: { runId: v.id("agentRuns") },
    returns: v.object({ ok: v.boolean() }),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        if (!run || run.status !== "running") return { ok: false };

        try {
            // Idempotent: skip if KPI was already recorded (or deliberately skipped).
            if (run.pipeline?.kpiResolved &&
                (run.trigger !== "proactive" || run.pipeline.evidenceId)) {
                await advanceRun(ctx, run, "log_kpi_checkin", "Already recorded");
                await scheduleNextStep(ctx, run, "log_kpi_checkin");
                return { ok: true };
            }

            const venture = await ctx.db.get(run.ventureId);
            if (!venture) throw new Error("Venture not found");

            const now = Date.now();
            // A proactive run may only consume an immutable evidence record.
            // Never let a stray valueOverride or a replayed job turn approval
            // into a public effect without founder evidence.
            const resolved =
                run.trigger === "proactive" && !run.pipeline?.evidenceId
                    ? null
                    : resolveKpi(run, venture.kpiUnit);

            if (!resolved) {
                if (run.trigger === "proactive") {
                    // Park rather than advancing to digest/ledger/reply. The
                    // only legal continuation is a sourced evidence submission.
                    const kpiIndex = run.steps.findIndex(
                        (step) => step.tool === "log_kpi_checkin"
                    );
                    const steps = run.steps.map((step, index) =>
                        index === kpiIndex
                            ? {
                                  ...step,
                                  status: "pending" as const,
                                  detail: "Waiting for sourced founder evidence",
                              }
                            : step
                    );
                    await ctx.db.patch(run._id, {
                        status: "waiting_for_response",
                        steps,
                        updatedAt: now,
                    });
                    await syncInvestorBriefing(ctx, run.investorId);
                    return { ok: true };
                }

                // Evidence-backed non-proactive notes may complete without a
                // KPI, but still disclose that no number was recorded.
                await ctx.db.patch(run._id, {
                    pipeline: { ...run.pipeline, kpiResolved: true },
                    updatedAt: now,
                });
                await advanceRun(ctx, run, "log_kpi_checkin", "No sourced evidence — skipped");
                await scheduleNextStep(ctx, run, "log_kpi_checkin");
                return { ok: true };
            }

            const { metric, value } = resolved;

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
                evidenceSource: run.evidenceSource ?? null,
                evidenceId: run.pipeline?.evidenceId ?? null,
                appliedItemId,
                createdAt: now,
            });

            const checkinEventId = await writeLedgerEvent(ctx, {
                type: "checkin",
                ventureId: venture._id,
                commitmentId: run.commitmentId,
                summary: `${venture.name}: ${metric} = ${value} — Jua logged this from ${originPhrase(run)}`,
                metric,
                value,
                evidence: evidenceTags(run),
                createdAt: now,
                runId: run._id,
                correlationId: run.correlationId ?? run._id,
                parentEventId: run.pipeline?.requestEventId ?? null,
                initiator: "jua",
                approvalRunId: run._id,
            });

            // Persist pipeline state for idempotent retry.
            await ctx.db.patch(run._id, {
                pipeline: {
                    ...run.pipeline,
                    checkInId,
                    checkinEventId,
                    kpiMetric: metric,
                    kpiValue: value,
                    kpiBefore,
                    kpiAfter: kpiBefore + value,
                    kpiResolved: true,
                },
                updatedAt: now,
            });

            await advanceRun(ctx, run, "log_kpi_checkin", `${metric} = ${value}`);
            await scheduleNextStep(ctx, run, "log_kpi_checkin");
            return { ok: true };
        } catch (e) {
            const error = e instanceof Error ? e.message : "KPI step failed";
            await failRunInline(ctx, run, "log_kpi_checkin", error);
            return { ok: false };
        }
    },
});

export const stepWriteDigest = internalMutation({
    args: { runId: v.id("agentRuns") },
    returns: v.object({ ok: v.boolean() }),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        if (!run || run.status !== "running") return { ok: false };

        try {
            // Idempotent: skip if the digest was already written.
            if (run.pipeline?.digestId) {
                await advanceRun(ctx, run, "create_investor_digest", "Already written");
                await scheduleNextStep(ctx, run, "create_investor_digest");
                return { ok: true };
            }

            const venture = await ctx.db.get(run.ventureId);
            const commitment = await ctx.db.get(run.commitmentId);
            if (!venture || !commitment) throw new Error("Venture or commitment missing");

            const now = Date.now();
            const cadence = commitment.digestCadence ?? "Weekly · Fri 08:00 EAT";
            const kpiMetric = run.pipeline?.kpiMetric ?? null;
            const kpiValue = run.pipeline?.kpiValue ?? null;
            const digestSummary =
                kpiMetric != null && kpiValue != null
                    ? `I acted on ${originPhrase(run)} for ${venture.name}: logged ${kpiMetric} = ${kpiValue}.`
                    : `I acted on ${originPhrase(run)} for ${venture.name}: no sourced KPI was recorded this cycle.`;
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

            const digestEventId = await writeLedgerEvent(ctx, {
                type: "digest",
                ventureId: venture._id,
                commitmentId: run.commitmentId,
                summary: `Digest for ${venture.name}: ${digestSummary}`,
                evidence: evidenceTags(run),
                createdAt: now,
                runId: run._id,
                correlationId: run.correlationId ?? run._id,
                parentEventId: run.pipeline?.checkinEventId ?? run.pipeline?.requestEventId ?? null,
                initiator: "jua",
                approvalRunId: run._id,
            });

            await ctx.db.patch(run._id, {
                pipeline: { ...run.pipeline, digestId, digestEventId },
                updatedAt: now,
            });

            await advanceRun(ctx, run, "create_investor_digest", digestSummary);
            await scheduleNextStep(ctx, run, "create_investor_digest");
            return { ok: true };
        } catch (e) {
            const error = e instanceof Error ? e.message : "Digest step failed";
            await failRunInline(ctx, run, "create_investor_digest", error);
            return { ok: false };
        }
    },
});

export const stepPostLedger = internalMutation({
    args: { runId: v.id("agentRuns") },
    returns: v.object({ ok: v.boolean() }),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        if (!run || run.status !== "running") return { ok: false };

        try {
            // Idempotent: skip if the public ledger event was already posted.
            if (run.pipeline?.ledgerEventId) {
                await advanceRun(ctx, run, "post_public_ledger", "Already posted");
                await scheduleNextStep(ctx, run, "post_public_ledger");
                return { ok: true };
            }

            const venture = await ctx.db.get(run.ventureId);
            if (!venture) throw new Error("Venture not found");

            const now = Date.now();

            // Publish the APPROVED summary verbatim. The investor consented to
            // exactly this text; system metadata stays out of the public copy.
            const summary = publishedSummaryForRun(run, venture.name);

            const ledgerEventId = await writeLedgerEvent(ctx, {
                type: "action",
                ventureId: venture._id,
                commitmentId: run.commitmentId,
                summary,
                evidence: evidenceTags(run),
                createdAt: now,
                runId: run._id,
                correlationId: run.correlationId ?? run._id,
                parentEventId:
                    run.pipeline?.digestEventId ??
                    run.pipeline?.checkinEventId ??
                    run.pipeline?.requestEventId ??
                    null,
                initiator: "jua",
                approvalRunId: run._id,
            });

            await ctx.db.patch(run._id, {
                pipeline: { ...run.pipeline, ledgerEventId },
                updatedAt: now,
            });

            await advanceRun(ctx, run, "post_public_ledger", "checkin + digest + action events");
            await scheduleNextStep(ctx, run, "post_public_ledger");
            return { ok: true };
        } catch (e) {
            const error = e instanceof Error ? e.message : "Ledger step failed";
            await failRunInline(ctx, run, "post_public_ledger", error);
            return { ok: false };
        }
    },
});

export const stepSendReply = internalMutation({
    args: { runId: v.id("agentRuns") },
    returns: v.object({ ok: v.boolean() }),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        if (!run || run.status !== "running") return { ok: false };

        try {
            const venture = await ctx.db.get(run.ventureId);
            const commitment = await ctx.db.get(run.commitmentId);
            if (!venture || !commitment) throw new Error("Venture or commitment missing");

            const now = Date.now();
            const kpiMetric = run.pipeline?.kpiMetric ?? null;
            const kpiValue = run.pipeline?.kpiValue ?? null;
            const kpiAfter = run.pipeline?.kpiAfter ?? null;

            // Idempotent: reuse the already-sent reply instead of duplicating it.
            let replyId = run.pipeline?.replyId ?? null;
            if (!replyId) {
                const noteEcho =
                    run.trigger === "proactive" ? null : `You said: “${run.noteBody.slice(0, 140)}”`;
                const replySummary =
                    kpiMetric != null && kpiValue != null
                        ? `I acted on ${originPhrase(run)} for ${venture.name}: logged ${kpiMetric} = ${kpiValue}${kpiAfter != null ? ` (total now ${kpiAfter})` : ""}.`
                        : `I acted on ${originPhrase(run)} for ${venture.name}: no sourced KPI was recorded this cycle.`;
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

                replyId = await ctx.db.insert("agentEmails", {
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
            }

            const message =
                kpiMetric != null && kpiValue != null
                    ? `Agent replied and logged ${kpiMetric}=${kpiValue} for ${venture.name}.`
                    : `Agent replied for ${venture.name} (no sourced KPI recorded).`;
            const order = stepOrderFor(run);
            const idx = order.length - 1;
            const steps = run.steps.map((step, i) =>
                i === idx
                    ? { ...step, status: "done" as const, detail: `to ${run.fromAddress}` }
                    : step
            );
            await ctx.db.patch(run._id, {
                status: "completed",
                steps,
                pipeline: { ...run.pipeline, replyId },
                result: {
                    checkInId: run.pipeline?.checkInId ?? null,
                    digestId: run.pipeline?.digestId ?? null,
                    replyId,
                    message,
                    kpiMetric: kpiMetric ?? "",
                    kpiValue: kpiValue ?? 0,
                    kpiBefore: run.pipeline?.kpiBefore ?? 0,
                    kpiAfter: kpiAfter ?? 0,
                    replyTo: run.fromAddress,
                },
                updatedAt: Date.now(),
            });
            // Completion moves the run into the index's "completed" bucket.
            await syncInvestorBriefing(ctx, run.investorId);
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
                await syncInvestorBriefing(ctx, run.investorId);
            }
            failed++;
        }
        return { failed };
    },
});

// --- Proactive proposals: Jua suggests work, nothing runs until approval ---

/** How stale a venture's latest KPI may be before Jua proposes a check-in. */
const PROPOSAL_STALE_MS = 24 * 60 * 60 * 1000; // 24h — demo-friendly cadence

/**
 * Insert a `proposed` run for one commitment (shared by the proactive cron
 * and the demo seeder). Pure initiative — nothing runs until approval.
 */
export async function createProposalForCommitment(
    ctx: MutationCtx,
    commitment: Doc<"commitments">,
    venture: Doc<"ventures">,
    daysStale: number,
    lastCheckInAt: number | null = null,
    autonomyLevel: AutonomyLevel = "ask_every_time"
) {
    const now = Date.now();
    const actionPlan = buildProactiveActionPlan({
        ventureName: venture.name,
        daysStale,
        metricLabel: venture.kpiLabel || "KPI",
        lastCheckInAt,
        autonomyLevel,
    });
    const noteBody = [
        actionPlan.reason.whyNow,
        "I want to follow up, log the result as a KPI check-in, write you a digest, and post it to the public ledger.",
        "Approve and I'll get to work; dismiss if now is not the time.",
    ].join("\n");
    const runId = await ctx.db.insert("agentRuns", {
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
        actionPlan,
        correlationId: `proposal_${now}_${commitment._id}`,
        result: null,
        error: null,
        createdAt: now,
        updatedAt: now,
    });
    // A new proposal enters the "decisions" bucket of the briefing index.
    await syncInvestorBriefing(ctx, commitment.investorId);
    return runId;
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

            const autonomyLevel =
                (await ctx.db.get(commitment.investorId))?.autonomyLevel ?? "ask_every_time";

            const proposalRunId = await createProposalForCommitment(
                ctx,
                commitment,
                venture,
                Math.floor(staleMs / (24 * 60 * 60 * 1000)),
                lastCheckIn?.createdAt ?? null,
                autonomyLevel
            );
            proposed++;

            // auto_low_risk: the ONLY automated work is the private check-in
            // request (no public effect, no evidence fabrication). Start it now;
            // the run parks in waiting_for_response. Public effects still need
            // explicit approval after founder evidence arrives.
            if (isLowRiskAutoAction({ autonomyLevel, trigger: "proactive" })) {
                const run = await ctx.db.get(proposalRunId);
                if (run && run.status === "proposed") {
                    const order = stepOrderFor(run);
                    const steps = run.steps.map((step, i) =>
                        i === 0 && order[0]?.tool === step.tool
                            ? { ...step, status: "running" as const, detail: null }
                            : step
                    );
                    await ctx.db.patch(run._id, {
                        status: "running",
                        steps,
                        autoStarted: true,
                        updatedAt: Date.now(),
                    });
                    await ctx.scheduler.runAfter(
                        0,
                        internal.agentRuns.stepSendFounderRequest,
                        { runId: run._id }
                    );
                }
            }
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
        const proposal = recentRuns.find((run) => run.status === "proposed" && run.actionPlan);
        if (!proposal || !(await canReadInvestorRun(ctx, proposal))) return null;
        return {
            id: proposal._id,
            noteBody: proposal.noteBody,
            subject: proposal.subject,
            steps: proposal.steps,
            createdAt: proposal.createdAt,
        };
    },
});

/**
 * Canonical proposal detail — the single representation of an approval
 * contract. Returns the persisted action plan (never a reconstructed fallback),
 * so Today and the standalone /approvals/[proposalId] route render the same
 * reason, sources, previews, and recovery terms.
 */
export const getProposalDetail = query({
    args: { runId: v.id("agentRuns") },
    returns: v.union(actionPlanViewValidator, v.null()),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        if (!run || run.status !== "proposed" || !(await canReadInvestorRun(ctx, run))) return null;

        const venture = await ctx.db.get(run.ventureId);
        return planViewForRun(run, venture?.name ?? "Venture");
    },
});

/**
 * One plan-view builder for a run — the single representation of an approval
 * contract, shared by getProposalDetail and invest.ts's Today briefing so
 * inline and standalone approvals can never diverge.
 *
 * The persisted actionPlan IS the contract. Only legacy runs created before
 * the field existed lack one; those are rebuilt deterministically from the
 * run's own age and the venture's real metric label (never a stale constant).
 */
export function planViewForRun(run: Doc<"agentRuns">, ventureName: string) {
    const plan = run.actionPlan;
    if (!plan) return null;
    return {
        id: run._id,
        commitmentId: run.commitmentId,
        ventureName,
        subject: run.subject,
        noteBody: run.noteBody,
        status: run.status,
        createdAt: run.createdAt,
        reason: plan.reason,
        sources: plan.sources,
        planSteps: plan.planSteps,
        preview: plan.preview,
        permissions: plan.permissions,
        recovery: plan.recovery,
        durationEta: plan.durationEta ?? "within 24 hours",
    };
}

/**
 * Publication-approval view — the exact KPI and verbatim public summary an
 * investor consents to in the second step before anything is recorded or
 * published. Built only from persisted evidence on the run.
 */
export function publicationViewForRun(run: Doc<"agentRuns">, ventureName: string) {
    const metric = run.pipeline?.kpiMetric ?? run.metricOverride?.trim();
    const value = run.pipeline?.kpiValue ?? run.valueOverride;
    if (!metric || value == null || !Number.isFinite(value)) return null;
    return {
        id: run._id,
        commitmentId: run.commitmentId,
        ventureName,
        subject: run.subject,
        metric,
        value,
        publicSummary:
            run.approvedSummary ||
            run.actionPlan?.preview.publicSummary ||
            `Jua recorded ${metric} = ${value} for ${ventureName} with the founder's evidence.`,
        evidenceSource: run.evidenceSource ?? null,
        createdAt: run.createdAt,
    };
}

export const publicationViewValidator = v.object({
    id: v.id("agentRuns"),
    commitmentId: v.id("commitments"),
    ventureName: v.string(),
    subject: v.string(),
    metric: v.string(),
    value: v.number(),
    publicSummary: v.string(),
    evidenceSource: v.union(
        v.literal("founder_update"),
        v.literal("investor_entered"),
        v.null()
    ),
    createdAt: v.number(),
});

/**
 * The single decision entry point for a run: either a pending proposal plan
 * (first approval) or the publication-approval view (second approval). Used by
 * Today and the standalone approval route so both steps render the persisted
 * contract and never diverge.
 */
export const getRunDecision = query({
    args: { runId: v.id("agentRuns") },
    returns: v.union(
        v.null(),
        v.object({
            kind: v.literal("proposal"),
            plan: actionPlanViewValidator,
        }),
        v.object({
            kind: v.literal("publication"),
            publication: publicationViewValidator,
        })
    ),
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        if (!run || !(await canReadInvestorRun(ctx, run))) return null;
        const venture = await ctx.db.get(run.ventureId);
        const ventureName = venture?.name ?? "Venture";

        if (run.status === "awaiting_publication") {
            const publication = publicationViewForRun(run, ventureName);
            if (!publication) return null;
            return { kind: "publication" as const, publication };
        }

        if (run.status !== "proposed" || !run.actionPlan) return null;
        // planViewForRun is non-null here because run.actionPlan is present.
        return { kind: "proposal" as const, plan: planViewForRun(run, ventureName)! };
    },
});

/** Approve a proposal → same durable pipeline as an approved note. */
export const approveProposal = mutation({
    args: {
        runId: v.id("agentRuns"),
        /** Optional edit to the follow-up message before execution. */
        messageDraft: v.optional(v.string()),
        publicSummary: v.optional(v.string()),
    },
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
        await assertInvestorOwnsRun(ctx, run);
        if (!run.actionPlan) {
            throw new Error("Proposal has no persisted action plan and cannot be approved");
        }

        const investor = await ctx.db.get(run.investorId);
        if (investor?.autonomyLevel === "pause_all") {
            throw new Error("Automation is paused. Change autonomy in Account to approve.");
        }

        const now = Date.now();
        // Resume from the first uncommitted step. For a fresh proposal that is
        // the request/KPI step; for an auto_low_risk run parked back for public
        // approval it is the first public step (the request already ran).
        const resumeStep = firstUncommittedStep(run);
        if (!resumeStep) throw new Error("Nothing left to approve");
        const steps = run.steps.map((step) =>
            step.tool === resumeStep.tool && step.status !== "done"
                ? { ...step, status: "running" as const, detail: null }
                : step
        );
        const actionPlan = run.actionPlan
            ? {
                  ...run.actionPlan,
                  preview: {
                      ...run.actionPlan.preview,
                      messageDraft:
                          args.messageDraft?.trim() || run.actionPlan.preview.messageDraft || null,
                      publicSummary:
                          args.publicSummary?.trim() || run.actionPlan.preview.publicSummary || null,
                  },
              }
            : undefined;
        const noteBody =
            args.messageDraft?.trim() ||
            actionPlan?.preview.messageDraft ||
            run.noteBody;

        // The verbatim public summary the investor approved. stepPostLedger
        // publishes exactly this text — consent matches publication.
        const approvedSummary =
            args.publicSummary?.trim() ||
            actionPlan?.preview.publicSummary ||
            run.actionPlan?.preview.publicSummary ||
            null;

        await ctx.db.patch(run._id, {
            status: "running",
            steps,
            noteBody,
            actionPlan,
            approvedSummary: approvedSummary ?? undefined,
            // An explicit approval supersedes any earlier auto-start.
            autoStarted: false,
            correlationId: run.correlationId ?? `run_${now}_${run.commitmentId}`,
            updatedAt: now,
        });
        // Approval leaves the decisions bucket (run is now executing).
        await syncInvestorBriefing(ctx, run.investorId);

        await scheduleStepByTool(ctx, run, resumeStep.tool);
        return { runId: run._id, commitmentId: run.commitmentId, ventureId: run.ventureId };
    },
});

/**
 * The SECOND approval in a proactive check-in: approve the exact KPI and
 * public summary that evidence produced, then record + publish.
 *
 * The first approval only authorized sending the private check-in request.
 * Once founder evidence arrives the run parks in `awaiting_publication`; this
 * mutation is the explicit consent to log the KPI, write the digest, and post
 * to the public ledger. Nothing is recorded or published before it runs.
 */
export const publishApproval = mutation({
    args: {
        runId: v.id("agentRuns"),
        /** Optional final edit to the verbatim public summary. */
        publicSummary: v.optional(v.string()),
    },
    returns: v.object({
        runId: v.id("agentRuns"),
        commitmentId: v.id("commitments"),
        ventureId: v.id("ventures"),
    }),
    handler: async (ctx, args) => {
        await assertCanAct(ctx);
        await rateLimiter.limit(ctx, "investMutate", { key: "agentRun" });
        const run = await ctx.db.get(args.runId);
        if (!run) throw new Error("Run not found");
        if (run.status !== "awaiting_publication") {
            throw new Error("This run is not waiting for publication approval");
        }
        await assertInvestorOwnsRun(ctx, run);

        const investor = await ctx.db.get(run.investorId);
        if (investor?.autonomyLevel === "pause_all") {
            throw new Error("Automation is paused. Change autonomy in Account to publish.");
        }
        if (!run.pipeline?.evidenceId) {
            throw new Error("No sourced evidence on file — nothing to publish");
        }

        const resumeStep = firstUncommittedStep(run);
        if (!resumeStep) throw new Error("Nothing left to approve");
        const steps = run.steps.map((step) =>
            step.tool === resumeStep.tool && step.status !== "done"
                ? { ...step, status: "running" as const, detail: null }
                : step
        );

        // Capture the verbatim public summary the investor now consents to.
        const publicSummary = args.publicSummary?.trim();
        const approvedSummary =
            publicSummary || run.approvedSummary || run.actionPlan?.preview.publicSummary || null;

        await ctx.db.patch(run._id, {
            status: "running",
            steps,
            approvedSummary: approvedSummary ?? undefined,
            updatedAt: Date.now(),
        });
        // Publication approval leaves the decisions bucket (run is executing).
        await syncInvestorBriefing(ctx, run.investorId);

        await scheduleStepByTool(ctx, run, resumeStep.tool);
        return { runId: run._id, commitmentId: run.commitmentId, ventureId: run.ventureId };
    },
});

/**
 * Submit sourced founder evidence for a run parked in `waiting_for_response`.
 * This is the ONLY path that records a KPI for a proactive check-in: the
 * founder responds with a real number, Jua validates it, then the pipeline
 * resumes (record KPI → digest → ledger → reply). No evidence, no KPI.
 */
export const submitFounderEvidence = mutation({
    args: {
        runId: v.id("agentRuns"),
        metric: v.optional(v.string()),
        value: v.number(),
        note: v.optional(v.string()),
    },
    returns: v.object({ ok: v.boolean(), message: v.string() }),
    handler: async (ctx, args) => {
        await assertCanAct(ctx);
        await rateLimiter.limit(ctx, "investMutate", { key: "agentRun" });

        const run = await ctx.db.get(args.runId);
        if (!run) throw new Error("Run not found");
        await assertInvestorOwnsRun(ctx, run);
        if (run.status !== "waiting_for_response") {
            throw new Error("This run is not waiting for founder evidence");
        }
        if (!Number.isFinite(args.value) || args.value <= 0) {
            throw new Error("Evidence value must be a positive number");
        }

        const investor = await ctx.db.get(run.investorId);
        if (investor?.autonomyLevel === "pause_all") {
            throw new Error("Automation is paused. Change autonomy in Account to continue.");
        }

        const venture = await ctx.db.get(run.ventureId);
        if (!venture) throw new Error("Venture not found");

        const now = Date.now();
        const metric = args.metric?.trim() || defaultMetricFor(venture.kpiUnit);
        const userId = await getAuthUserId(ctx);
        const evidenceId = await insertFounderEvidence(ctx, {
            runId: run._id,
            ventureId: run.ventureId,
            commitmentId: run.commitmentId,
            metric,
            value: args.value,
            note: args.note?.trim() || run.noteBody,
            source: "investor_entered",
            submittedByUserId: userId,
        });

        // Stamp the sourced evidence onto the run.
        const evidencePatch = {
            metricOverride: metric,
            valueOverride: args.value,
            noteBody: args.note?.trim() || run.noteBody,
            evidenceSource: "investor_entered" as const,
            updatedAt: now,
        };

        // Two-step consent: evidence is recorded on the run but NOTHING is
        // logged or published until the investor approves the exact KPI and
        // public summary. Park in awaiting_publication; publishApproval resumes.
        await ctx.db.patch(run._id, {
            ...evidencePatch,
            status: "awaiting_publication",
            autoStarted: false,
            pipeline: { ...run.pipeline, evidenceId },
        });
        // Evidence moves the run into the decisions bucket for the second approval.
        await syncInvestorBriefing(ctx, run.investorId);
        return {
            ok: true,
            message: `Evidence received (${metric} = ${args.value}). Review the exact KPI and public summary, then approve publication.`,
        };
    },
});

/** Edit proposal preview without approving. */
export const updateProposalPlan = mutation({
    args: {
        runId: v.id("agentRuns"),
        messageDraft: v.optional(v.string()),
        publicSummary: v.optional(v.string()),
        noteBody: v.optional(v.string()),
    },
    returns: v.object({ ok: v.boolean() }),
    handler: async (ctx, args) => {
        await assertCanAct(ctx);
        const run = await ctx.db.get(args.runId);
        if (!run || run.status !== "proposed") return { ok: false };
        await assertInvestorOwnsRun(ctx, run);
        const actionPlan = run.actionPlan
            ? {
                  ...run.actionPlan,
                  preview: {
                      ...run.actionPlan.preview,
                      messageDraft:
                          args.messageDraft !== undefined
                              ? args.messageDraft
                              : run.actionPlan.preview.messageDraft,
                      publicSummary:
                          args.publicSummary !== undefined
                              ? args.publicSummary
                              : run.actionPlan.preview.publicSummary,
                  },
              }
            : undefined;
        await ctx.db.patch(run._id, {
            noteBody: args.noteBody?.trim() || run.noteBody,
            actionPlan,
            updatedAt: Date.now(),
        });
        return { ok: true };
    },
});

/** Compute retry state without changing the run or duplicating committed effects. */
export function retryStateForRun(run: Doc<"agentRuns">) {
    const resumeIdx = run.steps.findIndex(
        (step) =>
            step.status === "failed" ||
            step.status === "pending" ||
            step.status === "running"
    );
    if (resumeIdx < 0) return null;
    return {
        resumeIdx,
        resumeTool: run.steps[resumeIdx]!.tool,
        steps: run.steps.map((step, index) => {
            if (index === resumeIdx) return { ...step, status: "running" as const, detail: null };
            if (index > resumeIdx && (step.status === "failed" || step.status === "running")) {
                return { ...step, status: "pending" as const, detail: null };
            }
            return step;
        }),
    };
}

/**
 * Retry a failed run by RESUMING it from the first uncommitted step.
 *
 * The original run is reused, so the approved action plan, edited previews,
 * permission scope, recovery agreement, and correlation lineage are all
 * preserved. Each step executor is idempotent (guarded by run.pipeline), so a
 * step that already committed its effect (KPI, digest, ledger, reply) is never
 * duplicated — the chain picks up at the first step that did not commit.
 */
export const retryFailedRun = mutation({
    args: { runId: v.id("agentRuns") },
    returns: v.object({
        runId: v.id("agentRuns"),
        commitmentId: v.id("commitments"),
        ventureId: v.id("ventures"),
    }),
    handler: async (ctx, args) => {
        await assertCanAct(ctx);
        await rateLimiter.limit(ctx, "investMutate", { key: "agentRun" });
        const failed = await ctx.db.get(args.runId);
        if (!failed) throw new Error("Run not found");
        if (failed.status !== "failed") throw new Error("Only failed runs can be retried");
        await assertInvestorOwnsRun(ctx, failed);

        const investor = await ctx.db.get(failed.investorId);
        if (investor?.autonomyLevel === "pause_all") {
            throw new Error("Automation is paused. Change autonomy in Account to retry.");
        }

        const retry = retryStateForRun(failed);
        if (!retry) {
            // Nothing left to do — mark completed rather than re-running effects.
            throw new Error("All steps already committed — nothing to retry");
        }

        const now = Date.now();
        const { resumeTool, steps } = retry;
        await ctx.db.patch(failed._id, {
            status: "running",
            steps,
            error: null,
            // Keep correlationId, actionPlan, approvedSummary, pipeline intact.
            updatedAt: now,
        });
        // Retry leaves the failed bucket (blocked stat updates).
        await syncInvestorBriefing(ctx, failed.investorId);

        await scheduleStepByTool(ctx, failed, resumeTool);
        return { runId: failed._id, commitmentId: failed.commitmentId, ventureId: failed.ventureId };
    },
});

const activityItemValidator = v.object({
    id: v.id("agentRuns"),
    commitmentId: v.id("commitments"),
    ventureName: v.string(),
    status: runStatusValidator,
    trigger: runTriggerValidator,
    subject: v.string(),
    error: v.union(v.string(), v.null()),
    updatedAt: v.number(),
});

/**
 * Legacy scan path for investors without a briefing index yet (pre-backfill).
 * Kept so the activity feed stays correct until syncInvestorBriefing has run
 * for every investor.
 */
async function buildActivityFromScan(
    ctx: { db: QueryCtx["db"] },
    investorId: Id<"investors">,
    limit: number
) {
    const runs = await ctx.db
        .query("agentRuns")
        .withIndex("by_investorId", (q) => q.eq("investorId", investorId))
        .order("desc")
        .take(80);

    const active: Doc<"agentRuns">[] = [];
    const waiting: Doc<"agentRuns">[] = [];
    const completed: Doc<"agentRuns">[] = [];
    const blocked: Doc<"agentRuns">[] = [];
    const failed: Doc<"agentRuns">[] = [];

    for (const run of runs) {
        if (run.status === "running") active.push(run);
        else if (run.status === "waiting_for_response") waiting.push(run);
        else if (run.status === "proposed" || run.status === "awaiting_publication") {
            blocked.push(run);
        } else if (run.status === "failed") failed.push(run);
        else if (run.status === "completed") completed.push(run);
    }

    const toItem = async (run: Doc<"agentRuns">) => {
        const venture = await ctx.db.get(run.ventureId);
        return {
            id: run._id,
            commitmentId: run.commitmentId,
            ventureName: venture?.name ?? "Venture",
            status: run.status,
            trigger: run.trigger,
            subject: run.subject,
            error: run.error ?? null,
            updatedAt: run.updatedAt,
        };
    };

    return {
        active: (await Promise.all(active.slice(0, limit).map(toItem))).filter(Boolean),
        waiting: (await Promise.all(waiting.slice(0, limit).map(toItem))).filter(Boolean),
        completed: (await Promise.all(completed.slice(0, limit).map(toItem))).filter(Boolean),
        blocked: (await Promise.all(blocked.slice(0, limit).map(toItem))).filter(Boolean),
        failed: (await Promise.all(failed.slice(0, limit).map(toItem))).filter(Boolean),
    };
}

/** Investor activity center: active, waiting, completed, blocked, failed. */
export const activityForInvestor = query({
    args: {
        investorId: v.optional(v.id("investors")),
        limit: v.optional(v.number()),
    },
    returns: v.object({
        active: v.array(activityItemValidator),
        waiting: v.array(activityItemValidator),
        completed: v.array(activityItemValidator),
        blocked: v.array(activityItemValidator),
        failed: v.array(activityItemValidator),
    }),
    handler: async (ctx, args) => {
        const userId = await getAuthUserId(ctx);
        const linkedInvestor = userId
            ? await ctx.db
                  .query("investors")
                  .withIndex("by_userId", (q) => q.eq("userId", userId))
                  .first()
            : null;
        // Activity contains run state and is never a public/default-demo feed.
        if (!linkedInvestor || (args.investorId && args.investorId !== linkedInvestor._id)) {
            return { active: [], waiting: [], completed: [], blocked: [], failed: [] };
        }
        const investorId = linkedInvestor._id;
        const limit = Math.min(Math.max(args.limit ?? 20, 1), 50);
        if (!investorId) {
            return { active: [], waiting: [], completed: [], blocked: [], failed: [] };
        }

        // Primary path: the denormalized briefing index (O(1) reads).
        const briefing = await ctx.db
            .query("investorBriefings")
            .withIndex("by_investorId", (q) => q.eq("investorId", investorId!))
            .first();
        if (!briefing) return await buildActivityFromScan(ctx, investorId, limit);

        // Map the stored rows to the exact activity item shape (strips the
        // optional title/proofEventId/createdAt fields the index carries).
        const toItem = (item: (typeof briefing.decisions)[number]) => ({
            id: item.id,
            commitmentId: item.commitmentId,
            ventureName: item.ventureName,
            status: item.status,
            trigger: item.trigger,
            subject: item.subject,
            error: item.error,
            updatedAt: item.updatedAt,
        });

        return {
            active: briefing.active.slice(0, limit).map(toItem),
            waiting: briefing.waiting.slice(0, limit).map(toItem),
            completed: briefing.completed.slice(0, limit).map(toItem),
            blocked: briefing.decisions.slice(0, limit).map(toItem),
            failed: briefing.failed.slice(0, limit).map(toItem),
        };
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
        await assertInvestorOwnsRun(ctx, run);
        await ctx.db.patch(run._id, { status: "dismissed", updatedAt: Date.now() });
        // Dismissal leaves the decisions bucket.
        await syncInvestorBriefing(ctx, run.investorId);
        return { ok: true };
    },
});
