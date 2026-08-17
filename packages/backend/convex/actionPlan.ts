import { v } from "convex/values";

/** Investor autonomy: how much Jua may start without a fresh approve. */
export const autonomyLevelValidator = v.union(
    v.literal("ask_every_time"),
    v.literal("auto_low_risk"),
    v.literal("pause_all")
);

export type AutonomyLevel = "ask_every_time" | "auto_low_risk" | "pause_all";

export const actionStepVisibilityValidator = v.union(v.literal("public"), v.literal("private"));

export const actionPlanStepValidator = v.object({
    tool: v.string(),
    label: v.string(),
    visibility: actionStepVisibilityValidator,
    effect: v.string(),
});

export const actionPlanSourceValidator = v.object({
    kind: v.string(),
    label: v.string(),
    refId: v.optional(v.union(v.string(), v.null())),
});

export const actionPlanReasonValidator = v.object({
    whyNow: v.string(),
    trigger: v.string(),
    signals: v.array(v.string()),
});

export const actionPlanPreviewValidator = v.object({
    messageDraft: v.optional(v.union(v.string(), v.null())),
    publicSummary: v.optional(v.union(v.string(), v.null())),
    kpiDelta: v.optional(v.union(v.string(), v.null())),
});

export const actionPlanPermissionsValidator = v.object({
    scope: v.union(v.literal("once"), v.literal("policy")),
    autonomyLevel: autonomyLevelValidator,
});

export const actionPlanRecoveryValidator = v.object({
    onFail: v.union(v.literal("pause"), v.literal("retry"), v.literal("ask")),
    undoHint: v.string(),
});

/** Structured delegated-authority contract for proposals and runs. */
export const actionPlanValidator = v.object({
    reason: actionPlanReasonValidator,
    sources: v.array(actionPlanSourceValidator),
    planSteps: v.array(actionPlanStepValidator),
    preview: actionPlanPreviewValidator,
    permissions: actionPlanPermissionsValidator,
    recovery: actionPlanRecoveryValidator,
    durationEta: v.optional(v.union(v.string(), v.null())),
});

export type ActionPlan = {
    reason: { whyNow: string; trigger: string; signals: string[] };
    sources: Array<{ kind: string; label: string; refId?: string | null }>;
    planSteps: Array<{
        tool: string;
        label: string;
        visibility: "public" | "private";
        effect: string;
    }>;
    preview: {
        messageDraft?: string | null;
        publicSummary?: string | null;
        kpiDelta?: string | null;
    };
    permissions: { scope: "once" | "policy"; autonomyLevel: AutonomyLevel };
    recovery: { onFail: "pause" | "retry" | "ask"; undoHint: string };
    durationEta?: string | null;
};

/** API shape including identity for Today / Approval UI. */
export const actionPlanViewValidator = v.object({
    id: v.string(),
    commitmentId: v.string(),
    ventureName: v.string(),
    subject: v.string(),
    noteBody: v.string(),
    status: v.string(),
    createdAt: v.number(),
    reason: actionPlanReasonValidator,
    sources: v.array(actionPlanSourceValidator),
    planSteps: v.array(actionPlanStepValidator),
    preview: actionPlanPreviewValidator,
    permissions: actionPlanPermissionsValidator,
    recovery: actionPlanRecoveryValidator,
    durationEta: v.optional(v.union(v.string(), v.null())),
});

export const DEFAULT_PLAN_STEPS: ActionPlan["planSteps"] = [
    {
        tool: "log_kpi_checkin",
        label: "Log KPI",
        visibility: "public",
        effect: "Record this week's metric on the venture scorecard and public proof.",
    },
    {
        tool: "create_investor_digest",
        label: "Write digest",
        visibility: "private",
        effect: "Draft a private weekly digest for you from the evidence on hand.",
    },
    {
        tool: "post_public_ledger",
        label: "Post to ledger",
        visibility: "public",
        effect: "Publish a public ledger action summarizing what changed.",
    },
    {
        tool: "send_reply",
        label: "Send reply",
        visibility: "private",
        effect: "Send a follow-up with evidence to the venture channel.",
    },
];

export function buildProactiveActionPlan(args: {
    ventureName: string;
    daysStale: number;
    metricLabel: string;
    lastCheckInAt: number | null;
    autonomyLevel?: AutonomyLevel;
}): ActionPlan {
    const age =
        args.daysStale <= 0
            ? "today"
            : `${args.daysStale} day${args.daysStale === 1 ? "" : "s"} ago`;
    const whyNow = `${args.ventureName} has not reported in ${age}. The latest ${args.metricLabel} on file is getting stale.`;
    const messageDraft = `Hi — checking in on ${args.ventureName}. Please share this week's ${args.metricLabel} and what moved.`;
    const publicSummary = `Jua requested a weekly check-in for ${args.ventureName} after ${age} without a report.`;

    return {
        reason: {
            whyNow,
            trigger: "proactive",
            signals: [
                `Last KPI activity: ${age}`,
                `Metric watched: ${args.metricLabel}`,
                ...(args.lastCheckInAt
                    ? [`Last check-in at ${new Date(args.lastCheckInAt).toISOString()}`]
                    : ["No check-in on file yet"]),
            ],
        },
        sources: [
            {
                kind: "kpi_staleness",
                label: `${args.metricLabel} older than 24h`,
                refId: null,
            },
            {
                kind: "venture",
                label: args.ventureName,
                refId: null,
            },
        ],
        planSteps: DEFAULT_PLAN_STEPS,
        preview: {
            messageDraft,
            publicSummary,
            kpiDelta: null,
        },
        permissions: {
            scope: "once",
            autonomyLevel: args.autonomyLevel ?? "ask_every_time",
        },
        recovery: {
            onFail: "ask",
            undoHint: "Dismiss stops this proposal. Failed runs can be retried from Today or the run screen.",
        },
        durationEta: "within 24 hours",
    };
}

export function synthesizeBriefingText(args: {
    firstName: string | null;
    needsDecision: number;
    venturesMoved: number;
    blocked: number;
    decisionVenture: string | null;
}): string {
    const greeting = args.firstName ? `Good day, ${args.firstName}.` : "Good day.";
    if (args.needsDecision > 0 && args.decisionVenture) {
        const moved =
            args.venturesMoved > 0
                ? `${args.venturesMoved} venture${args.venturesMoved === 1 ? "" : "s"} moved.`
                : "No other ventures moved.";
        return `${greeting} ${moved} ${args.decisionVenture} needs your decision.`;
    }
    if (args.blocked > 0) {
        return `${greeting} ${args.blocked} run${args.blocked === 1 ? "" : "s"} need recovery. I paused until you choose next.`;
    }
    if (args.venturesMoved > 0) {
        return `${greeting} I handled updates from ${args.venturesMoved} venture${args.venturesMoved === 1 ? "" : "s"}. Nothing needs your decision right now.`;
    }
    return `${greeting} I'm watching your ventures. When something needs a decision, it will land here.`;
}
