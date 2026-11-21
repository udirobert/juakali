/**
 * Private backer–venture-lead workspace.
 *
 * A quiet four-Friday loop between one verified backer and one verified
 * venture lead: the lead reports a measure they chose (in their own words)
 * plus an optional help request each week, the backer picks exactly one of
 * three responses, the lead later marks whether it helped. Industry-agnostic:
 * there is no industry enum — the pair names the measure, the unit, and an
 * optional pricing focus themselves.
 *
 * Privacy rules that keep this safe:
 *  - Every read/write derives identity from `getAuthUserId` + the users row.
 *    No caller-supplied ids, no email-based reads after binding.
 *  - Membership requires a real verified email user (`emailVerificationTime`,
 *    non-anonymous). The whole feature is CLOSED while the demo inbox
 *    (SOFT_AUTH_INBOX=1) is enabled, because login links are peekable there.
 *  - Invites expose only {id, name, backerLabel} to the invitee's inbox —
 *    never financials, notes, or membership lists to nonmembers.
 *  - Nothing here writes to the public ledger, commitments, agent runs, or
 *    integrations, and nothing sends email or moves money.
 */
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
    internalMutation,
    mutation,
    query,
    type MutationCtx,
    type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { rateLimiter } from "./rateLimit";
import {
    measureValidator,
    outcomeValidator,
    requestKindValidator,
    responseValidator,
    supportKindValidator,
    workspaceRoleValidator,
} from "./privateWorkspaceFields";
import { env } from "./env";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

type Measure = { label: string; unit: string; precision: "whole" | "decimal" };
type RequestKind = "supplier" | "introduction" | "pricing" | "feedback" | "other";

/**
 * Friday 18:00 Nairobi time = 15:00 UTC, always on the Friday at/after `now`.
 * Used for the four one-shot week deadlines.
 */
function nextFridayDeadline(now: number): number {
    const base = new Date(now);
    base.setUTCHours(15, 0, 0, 0);
    const next = base.getTime() + ((5 - base.getUTCDay() + 7) % 7) * 86400000;
    return next > now ? next : next + 7 * 86400000;
}

function normalizeEmail(raw: string): string {
    return raw.trim().toLowerCase();
}

function validEmail(email: string): boolean {
    return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Trim a free-text field; empty after trim is null. Case is preserved. */
function phrase(raw: string | undefined): string | null {
    const s = raw?.trim();
    return s ? s : null;
}

function validMeasure(m: Measure): string | null {
    if (!m || typeof m !== "object") return "Tell us what you are tracking.";
    const label = phrase(m.label);
    const unit = phrase(m.unit);
    if (!label) return "The measure needs a label — e.g. 'Completed jobs'.";
    if (!unit) return "The measure needs a unit — e.g. 'jobs' or 'hours'.";
    if (label.length > 60) return "Keep the measure label under 60 characters.";
    if (unit.length > 24) return "Keep the unit under 24 characters.";
    if (m.precision !== "whole" && m.precision !== "decimal") {
        return "Choose whole numbers or decimals for the measure.";
    }
    return null;
}

function validValue(value: number, precision: Measure["precision"]): boolean {
    if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
        return false;
    }
    if (precision === "whole") return Number.isSafeInteger(value);
    return true;
}

/**
 * The verified signed-in user this feature requires, or null. Anonymous,
 * unverified-email, and missing accounts are all null — the caller decides
 * whether that is a signed-out or a must-verify screen.
 */
async function workspaceUser(ctx: QueryCtx | MutationCtx): Promise<{
    id: Id<"users">;
    email: string;
} | null> {
    if (env.SOFT_AUTH_INBOX === "1") return null;
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user || user.isAnonymous || !user.email || user.emailVerificationTime == null) {
        return null;
    }
    return { id: userId, email: normalizeEmail(user.email) };
}

/** The caller's single workspace, if any — checked as backer first, then lead. */
async function ownWorkspace(
    ctx: QueryCtx | MutationCtx,
    userId: Id<"users">
): Promise<{ workspace: Doc<"privateWorkspaces">; role: "backer" | "lead" } | null> {
    const asBacker = await ctx.db
        .query("privateWorkspaces")
        .withIndex("by_backer", (q) => q.eq("backerId", userId))
        .first();
    if (asBacker) return { workspace: asBacker, role: "backer" };
    const asLead = await ctx.db
        .query("privateWorkspaces")
        .withIndex("by_lead", (q) => q.eq("leadId", userId))
        .first();
    if (asLead) return { workspace: asLead, role: "lead" };
    return null;
}

const reportViewValidator = v.union(
    v.object({
        value: v.number(),
        note: v.string(),
        ask: v.optional(v.string()),
        requestKind: v.optional(requestKindValidator),
        reportedAt: v.number(),
    }),
    v.null()
);

const weekViewValidator = v.object({
    id: v.id("privateWorkspaceWeeks"),
    week: v.number(),
    deadline: v.number(),
    closed: v.boolean(),
    /** null when absent — or when a backer may not see it yet (`reportPending`). */
    report: reportViewValidator,
    /** A report exists but is private to the lead until the week closes. */
    reportPending: v.boolean(),
    response: v.union(responseValidator, v.null()),
    outcome: v.union(outcomeValidator, v.null()),
    /** In-app Friday brief — only once the week is closed. */
    brief: v.union(v.array(v.string()), v.null()),
});

const inviteViewValidator = v.object({
    id: v.id("privateWorkspaces"),
    name: v.string(),
    backerLabel: v.string(),
});

/**
 * The labelled next-step suggestion for a request kind — a suggestion, not a
 * fact or an AI judgement. Shared by the open-ask decision card and the
 * closed-week Friday brief. The pricing suggestion uses the pair's own
 * pricingFocus phrase when one was recorded.
 */
function suggestedStep(kind: RequestKind | undefined, pricingFocus?: string): string {
    switch (kind) {
        case "supplier":
            return "Ask which supply is holding up the work before offering an introduction.";
        case "introduction":
            return "Ask whom the venture lead wants to meet before sharing contact details.";
        case "pricing":
            return pricingFocus
                ? `Offer to review ${pricingFocus} together.`
                : "Review the costs and price of one piece of work together.";
        case "feedback":
            return "Offer feedback on one specific piece of work.";
        default:
            return "Agree on one next step together.";
    }
}

/**
 * Deterministic local brief for a closed week — plain composition of stored
 * facts plus a clearly labelled suggestion. No AI, no external analysis.
 */
function weekBrief(week: Doc<"privateWorkspaceWeeks">, workspace: Doc<"privateWorkspaces">): string[] {
    const lines: string[] = [];
    const report = week.report;
    if (!report) {
        lines.push("No check-in received.");
        return lines;
    }
    const { label, unit } = workspace.measure;
    lines.push(`Venture lead reported ${label}: ${report.value} ${unit}. ${report.note}`);
    if (report.ask) {
        lines.push(`Asked for ${report.ask}`);
        lines.push(
            `Suggested next step — ${suggestedStep(report.requestKind, workspace.pricingFocus)}`
        );
    } else {
        lines.push("No help requested. No action needed.");
    }
    return lines;
}

export const desk = query({
    args: {},
    returns: v.union(
        v.object({ state: v.literal("signedout") }),
        v.object({ state: v.literal("verify") }),
        v.object({ state: v.literal("disabled") }),
        v.object({
            state: v.literal("lobby"),
            invites: v.array(inviteViewValidator),
        }),
        v.object({
            state: v.literal("home"),
            role: workspaceRoleValidator,
            workspace: v.object({
                id: v.id("privateWorkspaces"),
                name: v.string(),
                measure: measureValidator,
                supportKind: v.union(supportKindValidator, v.null()),
                budgetKes: v.union(v.number(), v.null()),
                pricingFocus: v.union(v.string(), v.null()),
                relationship: v.union(v.string(), v.null()),
                firstFriday: v.union(v.number(), v.null()),
                leadJoined: v.boolean(),
                leadEmail: v.string(),
            }),
            weeks: v.array(weekViewValidator),
            /** Oldest unanswered ask — the one decision in front of the backer. */
            openAsk: v.union(
                v.object({
                    weekId: v.id("privateWorkspaceWeeks"),
                    week: v.number(),
                    ask: v.string(),
                    requestKind: v.union(requestKindValidator, v.null()),
                    /** Labelled suggestion (not fact, not AI) — shown now. */
                    suggestion: v.string(),
                }),
                v.null()
            ),
            reviewComplete: v.boolean(),
        })
    ),
    handler: async (ctx) => {
        if (env.SOFT_AUTH_INBOX === "1") return { state: "disabled" as const };
        const userId = await getAuthUserId(ctx);
        if (!userId) return { state: "signedout" as const };
        const user = await workspaceUser(ctx);
        if (!user) return { state: "verify" as const };

        const workspace = await ownWorkspace(ctx, user.id);
        if (!workspace) {
            // Pending invites addressed to this verified email — expose only a
            // consent preview (name + who invited), never the workspace itself.
            const rows = await ctx.db
                .query("privateWorkspaces")
                .withIndex("by_invitee", (q) =>
                    q.eq("leadEmail", user.email).eq("leadId", undefined)
                )
                .take(10);
            const invites = [] as Array<{
                id: Id<"privateWorkspaces">;
                name: string;
                backerLabel: string;
            }>;
            for (const k of rows) {
                const backer = await ctx.db.get(k.backerId);
                invites.push({
                    id: k._id,
                    name: k.name,
                    backerLabel: backer?.email ?? "a backer",
                });
            }
            return { state: "lobby" as const, invites };
        }

        const { workspace: ws, role } = workspace;
        const weeks = await ctx.db
            .query("privateWorkspaceWeeks")
            .withIndex("by_workspace_week", (q) => q.eq("workspaceId", ws._id))
            .take(4);

        const views = weeks.map((w) => {
            const r = w.report;
            // Backer sees a report only once the week closes or when the lead
            // attached an explicit ask — the ask must surface immediately.
            const backerCanSee = w.closed || Boolean(r?.ask);
            const visible = role === "lead" ? r : backerCanSee ? r : null;
            return {
                id: w._id,
                week: w.week,
                deadline: w.deadline,
                closed: w.closed,
                report: visible
                    ? {
                          value: visible.value,
                          note: visible.note,
                          ask: visible.ask,
                          requestKind: visible.requestKind,
                          reportedAt: visible.reportedAt,
                      }
                    : null,
                reportPending: Boolean(r) && !visible,
                response: w.response ?? null,
                outcome: w.outcome ?? null,
                brief: w.closed ? weekBrief(w, ws) : null,
            };
        });
        views.sort((a, b) => a.week - b.week);

        const open = views
            .filter((w) => w.report?.ask && !w.response)
            .sort((a, b) => a.week - b.week)[0];

        return {
            state: "home" as const,
            role,
            workspace: {
                id: ws._id,
                name: ws.name,
                measure: ws.measure,
                supportKind: ws.supportKind ?? null,
                budgetKes: ws.budgetKes ?? null,
                pricingFocus: ws.pricingFocus ?? null,
                relationship: ws.relationship ?? null,
                firstFriday: ws.firstFriday ?? null,
                leadJoined: Boolean(ws.leadId),
                leadEmail: ws.leadEmail,
            },
            weeks: views,
            openAsk: open
                ? {
                      weekId: open.id,
                      week: open.week,
                      ask: open.report!.ask!,
                      requestKind: open.report!.requestKind ?? null,
                      suggestion: suggestedStep(
                          open.report!.requestKind,
                          ws.pricingFocus
                      ),
                  }
                : null,
            reviewComplete: views.length === 4 && views.every((w) => w.closed),
        };
    },
});

/**
 * Lightweight read for Home/landing surfaces — minimal metadata only so the
 * caller can draw a state-aware entry card. Never returns notes, asks,
 * amounts, the other member's email, or week ids: `desk` is the detail view.
 */
export const overview = query({
    args: {},
    returns: v.union(
        v.object({ state: v.literal("signedout") }),
        v.object({ state: v.literal("verify") }),
        v.object({ state: v.literal("disabled") }),
        v.object({ state: v.literal("empty") }),
        v.object({
            state: v.literal("invited"),
            name: v.string(),
            multiple: v.boolean(),
        }),
        v.object({
            state: v.union(
                v.literal("pending"),
                v.literal("request"),
                v.literal("report"),
                v.literal("feedback"),
                v.literal("active"),
                v.literal("complete")
            ),
            name: v.string(),
            week: v.optional(v.number()),
            completed: v.boolean(),
        })
    ),
    handler: async (ctx) => {
        if (env.SOFT_AUTH_INBOX === "1") return { state: "disabled" as const };
        const userId = await getAuthUserId(ctx);
        if (!userId) return { state: "signedout" as const };
        const user = await workspaceUser(ctx);
        if (!user) return { state: "verify" as const };

        const membership = await ownWorkspace(ctx, user.id);
        if (!membership) {
            const invites = await ctx.db
                .query("privateWorkspaces")
                .withIndex("by_invitee", (q) =>
                    q.eq("leadEmail", user.email).eq("leadId", undefined)
                )
                .take(2);
            if (invites.length === 0) return { state: "empty" as const };
            return {
                state: "invited" as const,
                name: invites[0]!.name,
                multiple: invites.length > 1,
            };
        }

        const { workspace: ws, role } = membership;
        const name = ws.name;
        if (!ws.leadId) {
            return { state: "pending" as const, name, completed: false };
        }

        const weeks = await ctx.db
            .query("privateWorkspaceWeeks")
            .withIndex("by_workspace_week", (q) => q.eq("workspaceId", ws._id))
            .take(4);
        weeks.sort((a, b) => a.week - b.week);
        const completed = weeks.length === 4 && weeks.every((w) => w.closed);

        if (role === "backer") {
            const ask = weeks.find((w) => w.report?.ask && !w.response);
            if (ask) {
                return { state: "request" as const, name, week: ask.week, completed };
            }
        } else {
            const followUp = weeks.find(
                (w) =>
                    (w.response === "help" || w.response === "talk") &&
                    !w.outcome
            );
            if (followUp) {
                return {
                    state: "feedback" as const,
                    name,
                    week: followUp.week,
                    completed,
                };
            }
        }
        if (completed) return { state: "complete" as const, name, completed };
        if (role === "lead") {
            const open = weeks.find((w) => !w.closed);
            if (open && !open.report) {
                return { state: "report" as const, name, week: open.week, completed };
            }
        }
        const open = weeks.find((w) => !w.closed);
        return {
            state: "active" as const,
            name,
            week: open?.week,
            completed,
        };
    },
});

export const create = mutation({
    args: {
        name: v.string(),
        leadEmail: v.string(),
        measure: measureValidator,
        supportKind: v.optional(supportKindValidator),
        budgetKes: v.optional(v.number()),
        pricingFocus: v.optional(v.string()),
        relationship: v.optional(v.string()),
    },
    returns: v.object({ workspaceId: v.id("privateWorkspaces") }),
    handler: async (ctx, args) => {
        const user = await workspaceUser(ctx);
        if (!user) {
            throw new Error(
                "Private workspaces need a verified email sign-in and are unavailable while the demo inbox is enabled."
            );
        }
        await rateLimiter.limit(ctx, "investMutate", { key: `workspace_${user.id}` });

        const name = args.name.trim();
        if (name.length < 1 || name.length > 80) {
            throw new Error("Name the workspace in 1–80 characters.");
        }
        const leadEmail = normalizeEmail(args.leadEmail);
        if (!validEmail(leadEmail)) {
            throw new Error("Enter a valid email for the venture lead.");
        }
        if (leadEmail === user.email) {
            throw new Error("You cannot invite yourself — choose a different address.");
        }
        const measureError = validMeasure(args.measure);
        if (measureError) throw new Error(measureError);
        const measure: Measure = {
            label: args.measure.label.trim(),
            unit: args.measure.unit.trim(),
            precision: args.measure.precision,
        };
        const pricingFocus = phrase(args.pricingFocus);
        if (pricingFocus && pricingFocus.length > 100) {
            throw new Error("Keep the pricing focus under 100 characters.");
        }
        const relationship = phrase(args.relationship);
        if (relationship && relationship.length > 50) {
            throw new Error("Keep the relationship under 50 characters.");
        }
        if (args.budgetKes !== undefined) {
            if (!args.supportKind) {
                throw new Error("Set how you understand the support before an amount.");
            }
            if (!Number.isSafeInteger(args.budgetKes) || args.budgetKes < 0) {
                throw new Error("Budget must be a whole amount of KES, zero or more.");
            }
        }
        if (await ownWorkspace(ctx, user.id)) {
            throw new Error("You already have a private workspace.");
        }
        const now = Date.now();
        const workspaceId = await ctx.db.insert("privateWorkspaces", {
            backerId: user.id,
            leadEmail,
            name,
            measure,
            supportKind: args.supportKind,
            budgetKes: args.supportKind ? args.budgetKes : undefined,
            pricingFocus: pricingFocus ?? undefined,
            relationship: relationship ?? undefined,
            createdAt: now,
            updatedAt: now,
        });
        return { workspaceId };
    },
});

export const changeInvite = mutation({
    args: { workspaceId: v.id("privateWorkspaces"), leadEmail: v.string() },
    returns: v.null(),
    handler: async (ctx, args) => {
        const user = await workspaceUser(ctx);
        if (!user) throw new Error("Sign in with a verified email first.");
        await rateLimiter.limit(ctx, "investMutate", { key: `workspace_${user.id}` });
        const ws = await ctx.db.get(args.workspaceId);
        if (!ws || ws.backerId !== user.id) {
            throw new Error("That workspace is not yours.");
        }
        if (ws.leadId) {
            throw new Error("The venture lead has already joined — the invite is settled.");
        }
        const leadEmail = normalizeEmail(args.leadEmail);
        if (!validEmail(leadEmail)) {
            throw new Error("Enter a valid email for the venture lead.");
        }
        if (leadEmail === user.email) {
            throw new Error("You cannot invite yourself — choose a different address.");
        }
        await ctx.db.patch(args.workspaceId, { leadEmail, updatedAt: Date.now() });
        return null;
    },
});

export const accept = mutation({
    args: { workspaceId: v.id("privateWorkspaces") },
    returns: v.null(),
    handler: async (ctx, args) => {
        const user = await workspaceUser(ctx);
        if (!user) throw new Error("Sign in with a verified email first.");
        const ws = await ctx.db.get(args.workspaceId);
        // One generic refusal — never reveal whether an id exists, who it is
        // addressed to, or whether someone else already joined.
        if (
            !ws ||
            ws.leadId ||
            ws.leadEmail !== user.email ||
            ws.backerId === user.id
        ) {
            throw new Error("Invitation not found or not addressed to you.");
        }
        if (await ownWorkspace(ctx, user.id)) {
            throw new Error("You already have a private workspace.");
        }

        // One atomic attach: lead id + four scheduled Friday weeks.
        const now = Date.now();
        const firstFriday = nextFridayDeadline(now);
        await ctx.db.patch(args.workspaceId, {
            leadId: user.id,
            firstFriday,
            updatedAt: now,
        });
        for (let i = 0; i < 4; i++) {
            const deadline = firstFriday + i * WEEK_MS;
            const weekId = await ctx.db.insert("privateWorkspaceWeeks", {
                workspaceId: args.workspaceId,
                week: i + 1,
                deadline,
                closed: false,
            });
            await ctx.scheduler.runAt(
                deadline,
                internal.privateWorkspace.closeWeek,
                { weekId }
            );
        }
        return null;
    },
});

/** Idempotent week close — scheduled at each deadline; no chasing, no email. */
export const closeWeek = internalMutation({
    args: { weekId: v.id("privateWorkspaceWeeks") },
    returns: v.null(),
    handler: async (ctx, args) => {
        const week = await ctx.db.get(args.weekId);
        if (!week || week.closed) return null;
        if (Date.now() < week.deadline) return null;
        await ctx.db.patch(args.weekId, { closed: true });
        return null;
    },
});

export const report = mutation({
    args: {
        value: v.number(),
        note: v.string(),
        ask: v.optional(v.string()),
        requestKind: v.optional(requestKindValidator),
    },
    returns: v.object({ weekId: v.id("privateWorkspaceWeeks") }),
    handler: async (ctx, args) => {
        const user = await workspaceUser(ctx);
        if (!user) throw new Error("Sign in with a verified email first.");
        const workspace = await ownWorkspace(ctx, user.id);
        if (!workspace || workspace.role !== "lead") {
            throw new Error("Only the joined venture lead can file this week's report.");
        }
        if (!validValue(args.value, workspace.workspace.measure.precision)) {
            throw new Error(
                workspace.workspace.measure.precision === "whole"
                    ? "Enter zero or a positive whole number."
                    : "Enter zero or a positive number."
            );
        }
        const note = args.note.trim();
        if (note.length < 1 || note.length > 600) {
            throw new Error("A short note is required (up to 600 characters).");
        }
        const ask = args.ask?.trim() || undefined;
        if (ask && ask.length > 300) {
            throw new Error("Keep the help request under 300 characters.");
        }
        if (!ask && args.requestKind) {
            throw new Error("Choose a request kind only when you ask for help.");
        }

        const now = Date.now();
        const weeks = await ctx.db
            .query("privateWorkspaceWeeks")
            .withIndex("by_workspace_week", (q) =>
                q.eq("workspaceId", workspace.workspace._id)
            )
            .take(4);
        const current = weeks.find(
            (w) => w.deadline - WEEK_MS <= now && now < w.deadline
        );
        if (!current) throw new Error("No week is open for a report right now.");
        if (current.closed) throw new Error("That week has already closed.");
        if (current.report) throw new Error("This week's report is already submitted.");

        await ctx.db.patch(current._id, {
            report: {
                value: args.value,
                note,
                ask,
                requestKind: ask ? args.requestKind : undefined,
                reportedAt: now,
            },
        });
        return { weekId: current._id };
    },
});

export const respond = mutation({
    args: { weekId: v.id("privateWorkspaceWeeks"), choice: responseValidator },
    returns: v.null(),
    handler: async (ctx, args) => {
        const user = await workspaceUser(ctx);
        if (!user) throw new Error("Sign in with a verified email first.");
        const workspace = await ownWorkspace(ctx, user.id);
        if (!workspace || workspace.role !== "backer") {
            throw new Error("Only the backer answers a help request.");
        }
        const week = await ctx.db.get(args.weekId);
        if (!week || week.workspaceId !== workspace.workspace._id) {
            throw new Error("That week does not belong to your workspace.");
        }
        if (!week.report?.ask) {
            throw new Error("There is no help request to answer here.");
        }
        if (week.response) {
            throw new Error("You already answered this request.");
        }
        await ctx.db.patch(args.weekId, { response: args.choice });
        return null;
    },
});

export const outcome = mutation({
    args: { weekId: v.id("privateWorkspaceWeeks"), result: outcomeValidator },
    returns: v.null(),
    handler: async (ctx, args) => {
        const user = await workspaceUser(ctx);
        if (!user) throw new Error("Sign in with a verified email first.");
        const workspace = await ownWorkspace(ctx, user.id);
        if (!workspace || workspace.role !== "lead") {
            throw new Error("Only the venture lead can say whether the help worked.");
        }
        const week = await ctx.db.get(args.weekId);
        if (!week || week.workspaceId !== workspace.workspace._id) {
            throw new Error("That week does not belong to your workspace.");
        }
        if (week.response !== "help" && week.response !== "talk") {
            throw new Error("There is no answered request to give feedback on.");
        }
        if (week.outcome === "helped") {
            throw new Error("This week is already marked helped.");
        }
        if (week.outcome === "not_yet" && args.result === "not_yet") {
            throw new Error("Already marked — you can change it to helped later.");
        }
        await ctx.db.patch(args.weekId, { outcome: args.result });
        return null;
    },
});
