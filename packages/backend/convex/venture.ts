/**
 * The venture owner (entrepreneur) side. The second party in the loop: they
 * see the wisdom their mentors applied, share situations/problems/opportunities
 * (Jua moderates those into digests via the durable run pipeline), and
 * self-report KPIs that carry the measurable outcomes.
 */
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

import { assertCanAct } from "./softAuth";
import { createAgentRun, resumeWaitingRunWithEvidence } from "./agentRuns";

const ventureUpdateTag = v.union(
    v.literal("situation"),
    v.literal("problem"),
    v.literal("opportunity"),
    v.literal("win")
);

/** Claim an unowned seeded venture for the signed-in user (demo path). */
export const claimVenture = mutation({
    args: {},
    returns: v.object({ ventureId: v.id("ventures"), message: v.string() }),
    handler: async (ctx) => {
        await assertCanAct(ctx);
        const userId = await getAuthUserId(ctx);
        if (!userId) throw new Error("Sign in first — your venture follows your identity.");

        const existing = await ctx.db
            .query("ventureOwners")
            .withIndex("by_userId", (q) => q.eq("userId", userId))
            .first();
        if (existing) {
            return { ventureId: existing.ventureId, message: "You already run a venture." };
        }

        // First active venture without an owner — demo keeps this deterministic.
        const ventures = await ctx.db
            .query("ventures")
            .withIndex("by_status", (q) => q.eq("status", "active"))
            .take(20);
        let claimed: typeof ventures[number] | null = null;
        for (const venture of ventures) {
            const owner = await ctx.db
                .query("ventureOwners")
                .withIndex("by_ventureId", (q) => q.eq("ventureId", venture._id))
                .first();
            if (!owner) {
                claimed = venture;
                break;
            }
        }
        if (!claimed) throw new Error("No unclaimed ventures right now — seed deals first.");

        await ctx.db.insert("ventureOwners", {
            userId,
            ventureId: claimed._id,
            role: "owner",
            createdAt: Date.now(),
        });
        return { ventureId: claimed._id, message: `You now run ${claimed.name}.` };
    },
});

/** The owner's cockpit payload — one query, their whole side of the loop. */
export const myVenture = query({
    args: {},
    returns: v.union(
        v.null(),
        v.object({
            ventureId: v.id("ventures"),
            name: v.string(),
            craftText: v.string(),
            locationText: v.string(),
            summary: v.string(),
            kpiLabel: v.string(),
            kpiTarget: v.number(),
            kpiTotal: v.number(),
            publicSlug: v.string(),
            checkIns: v.array(
                v.object({
                    id: v.id("kpiCheckIns"),
                    value: v.number(),
                    note: v.string(),
                    source: v.union(
                        v.literal("agent"),
                        v.literal("sms"),
                        v.literal("manual"),
                        v.literal("email_paste"),
                        v.literal("self")
                    ),
                    createdAt: v.number(),
                })
            ),
            recentDigests: v.array(
                v.object({
                    id: v.id("agentDigests"),
                    summary: v.string(),
                    createdAt: v.number(),
                })
            ),
        })
    ),
    handler: async (ctx) => {
        const userId = await getAuthUserId(ctx);
        if (!userId) return null;
        const owner = await ctx.db
            .query("ventureOwners")
            .withIndex("by_userId", (q) => q.eq("userId", userId))
            .first();
        if (!owner) return null;

        const venture = await ctx.db.get(owner.ventureId);
        if (!venture) return null;

        const checkInRows = await ctx.db
            .query("kpiCheckIns")
            .withIndex("by_ventureId", (q) => q.eq("ventureId", venture._id))
            .order("desc")
            .take(8);
        const kpiTotal = (
            await ctx.db
                .query("kpiCheckIns")
                .withIndex("by_ventureId", (q) => q.eq("ventureId", venture._id))
                .take(200)
        ).reduce((sum, row) => sum + row.value, 0);

        const digestRows = await ctx.db
            .query("agentDigests")
            .withIndex("by_ventureId", (q) => q.eq("ventureId", venture._id))
            .order("desc")
            .take(3);

        return {
            ventureId: venture._id,
            name: venture.name,
            craftText: venture.craftText,
            locationText: venture.locationText,
            summary: venture.summary,
            kpiLabel: venture.kpiLabel,
            kpiTarget: venture.kpiTarget,
            kpiTotal,
            publicSlug: venture.publicSlug,
            checkIns: checkInRows.map((row) => ({
                id: row._id,
                value: row.value,
                note: row.note,
                source: row.source,
                createdAt: row.createdAt,
            })),
            recentDigests: digestRows.map((row) => ({
                id: row._id,
                summary: row.summary,
                createdAt: row.createdAt,
            })),
        };
    },
});

/**
 * Share an update — situation, problem, opportunity, or win. Jua moderates:
 * it runs the same durable pipeline (KPI → digest → ledger → reply) so
 * mentors receive it as a digest and the ledger carries the proof.
 */
export const postVentureUpdate = mutation({
    args: {
        body: v.string(),
        tag: ventureUpdateTag,
        kpiValue: v.optional(v.number()),
    },
    returns: v.object({ message: v.string(), runId: v.union(v.id("agentRuns"), v.null()) }),
    handler: async (ctx, args) => {
        await assertCanAct(ctx);
        const userId = await getAuthUserId(ctx);
        if (!userId) throw new Error("Sign in first.");

        const body = args.body.trim();
        if (body.length === 0) throw new Error("Write a few words first.");

        const owner = await ctx.db
            .query("ventureOwners")
            .withIndex("by_userId", (q) => q.eq("userId", userId))
            .first();
        if (!owner) throw new Error("You don't run a venture yet — claim one first.");
        const venture = await ctx.db.get(owner.ventureId);
        if (!venture) throw new Error("Venture not found");

        // Any active commitment on this venture carries the run (demo keeps ≥1).
        const commitment = await ctx.db
            .query("commitments")
            .withIndex("by_ventureId", (q) => q.eq("ventureId", venture._id))
            .first();

        const tagLabel = args.tag.charAt(0).toUpperCase() + args.tag.slice(1);
        const now = Date.now();

        if (!commitment) {
            // No mentor capital yet — post to the ledger directly, Jua-free.
            await ctx.db.insert("ledgerEvents", {
                type: "action",
                ventureId: venture._id,
                commitmentId: null,
                summary: `${venture.name} · ${tagLabel} from the founder: ${body.slice(0, 140)}`,
                amountKes: null,
                metric: null,
                value: args.kpiValue ?? null,
                evidence: ["self"],
                createdAt: now,
                publicVisible: true,
            });
            return { message: "Posted to the public ledger.", runId: null };
        }

        // If Jua has an open check-in request waiting on this venture, the
        // founder's KPI-bearing update answers it — resume that run with the
        // sourced evidence instead of starting a duplicate.
        if (args.kpiValue != null) {
            const resumedRunId = await resumeWaitingRunWithEvidence(ctx, {
                ventureId: venture._id,
                metric: null,
                value: args.kpiValue,
                note: `${tagLabel} from the founder: ${body}`,
                submittedByUserId: userId,
            });
            if (resumedRunId) {
                return {
                    message: "Sent — that answers Jua's check-in request.",
                    runId: resumedRunId,
                };
            }
        }

        const run = await createAgentRun(ctx, {
            commitmentId: commitment._id,
            noteBody: `${tagLabel} from the founder: ${body}`,
            subject: `Update from ${venture.name}`,
            value: args.kpiValue ?? null,
            trigger: "entrepreneur_note",
            fromAddressOverride: venture.agentEmail ?? `${venture.publicSlug}@agent.juakali.demo`,
            source: "self",
        });

        await ctx.db.insert("ledgerEvents", {
            type: "action",
            ventureId: venture._id,
            commitmentId: commitment._id,
            summary: `${venture.name} · ${tagLabel} from the founder — Jua is turning it into a digest`,
            amountKes: null,
            metric: null,
            value: args.kpiValue ?? null,
            evidence: ["self", "agent"],
            createdAt: now,
            publicVisible: true,
        });

        return { message: "Sent — Jua is writing the digest for your mentors.", runId: run.runId };
    },
});

/** Self-reported KPI — the founder's own number, tagged to applied wisdom. */
export const logSelfCheckIn = mutation({
    args: {
        value: v.number(),
        note: v.optional(v.string()),
    },
    returns: v.object({ message: v.string() }),
    handler: async (ctx, args) => {
        await assertCanAct(ctx);
        const userId = await getAuthUserId(ctx);
        if (!userId) throw new Error("Sign in first.");
        if (!Number.isFinite(args.value) || args.value <= 0) throw new Error("Enter a positive number.");

        const owner = await ctx.db
            .query("ventureOwners")
            .withIndex("by_userId", (q) => q.eq("userId", userId))
            .first();
        if (!owner) throw new Error("You don't run a venture yet.");
        const venture = await ctx.db.get(owner.ventureId);
        if (!venture) throw new Error("Venture not found");

        const now = Date.now();
        const applied = await ctx.db
            .query("sharedItems")
            .withIndex("by_ventureId_and_status", (q) =>
                q.eq("ventureId", venture._id).eq("status", "applied")
            )
            .order("desc")
            .first();
        const appliedItemId =
            applied && applied.appliedAt != null && now - applied.appliedAt < 45 * 24 * 3600 * 1000
                ? applied._id
                : null;

        await ctx.db.insert("kpiCheckIns", {
            ventureId: venture._id,
            commitmentId: null,
            periodLabel: `Self · ${new Date(now).toISOString().slice(0, 10)}`,
            metric: venture.kpiUnit === "revenue_kes" ? "revenue_kes" : venture.kpiUnit === "jobs" ? "jobs_completed" : "meetings_booked",
            value: args.value,
            note: (args.note ?? "Founder self-report").slice(0, 160),
            source: "self",
            appliedItemId,
            createdAt: now,
        });

        await ctx.db.insert("ledgerEvents", {
            type: "checkin",
            ventureId: venture._id,
            commitmentId: null,
            summary: `${venture.name}: founder self-reported ${venture.kpiLabel.toLowerCase()} = ${args.value}`,
            amountKes: null,
            metric: venture.kpiLabel,
            value: args.value,
            evidence: ["self"],
            createdAt: now,
            publicVisible: true,
        });

        return { message: `Logged ${args.value} — your mentors will see it move.` };
    },
});
