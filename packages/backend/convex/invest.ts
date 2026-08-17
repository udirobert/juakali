import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { rateLimiter } from "./rateLimit";
import { normalizeKey } from "./juaKaliHelpers";
import {
    assertCanAct,
    assertInvestorOwnsInvestor,
} from "./softAuth";
import { createAgentRun, createProposalForCommitment, planViewForRun } from "./agentRuns";
import {
    actionPlanViewValidator,
    synthesizeBriefingText,
    autonomyLevelValidator,
} from "./actionPlan";

type DbCtx = { db: QueryCtx["db"] };

const kpiUnitValidator = v.union(v.literal("meetings"), v.literal("revenue_kes"), v.literal("jobs"));
const commitmentStatusValidator = v.union(
    v.literal("pledged"),
    v.literal("active"),
    v.literal("completed"),
    v.literal("written_off")
);
const kpiSourceValidator = v.union(
    v.literal("agent"),
    v.literal("sms"),
    v.literal("manual"),
    v.literal("email_paste"),
    v.literal("self")
);
const ledgerTypeValidator = v.union(
    v.literal("pledge"),
    v.literal("checkin"),
    v.literal("digest"),
    v.literal("action"),
    v.literal("wisdom")
);

const ventureSummaryValidator = v.object({
    id: v.id("ventures"),
    name: v.string(),
    craftText: v.string(),
    locationText: v.string(),
    summary: v.string(),
    kpiLabel: v.string(),
    kpiUnit: kpiUnitValidator,
    kpiTarget: v.number(),
    kpiLatest: v.number(),
    kpiTotal: v.number(),
    peerMedian: v.union(v.number(), v.null()),
    agentEmail: v.union(v.string(), v.null()),
    sparkline: v.array(v.number()),
    publicSlug: v.string(),
    status: v.union(v.literal("active"), v.literal("paused"), v.literal("graduated")),
    pledgedKes: v.number(),
});

function nextFridayEightEAT(fromMs: number = Date.now()) {
    const d = new Date(fromMs);
    const day = d.getUTCDay();
    // Approximate EAT (+3): target Friday 05:00 UTC = 08:00 EAT
    const daysUntilFri = (5 - day + 7) % 7 || 7;
    const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + daysUntilFri, 5, 0, 0));
    return next.getTime();
}

async function buildVentureSummary(ctx: DbCtx, ventureId: Id<"ventures">) {
    const venture = await ctx.db.get(ventureId);
    if (!venture) return null;
    const { kpiTotal, kpiLatest, checkIns } = await sumVentureKpis(ctx, venture._id);
    const pledgedKes = await pledgedForVenture(ctx, venture._id);
    const sparkline = checkIns
        .slice()
        .reverse()
        .slice(-4)
        .map((row) => row.value);
    return {
        id: venture._id,
        name: venture.name,
        craftText: venture.craftText,
        locationText: venture.locationText,
        summary: venture.summary,
        kpiLabel: venture.kpiLabel,
        kpiUnit: venture.kpiUnit,
        kpiTarget: venture.kpiTarget,
        kpiLatest,
        kpiTotal,
        peerMedian: venture.peerMedian ?? null,
        agentEmail: venture.agentEmail ?? null,
        sparkline,
        publicSlug: venture.publicSlug,
        status: venture.status,
        pledgedKes,
    };
}

async function sumVentureKpis(ctx: DbCtx, ventureId: Id<"ventures">) {
    const checkIns = await ctx.db
        .query("kpiCheckIns")
        .withIndex("by_ventureId", (q) => q.eq("ventureId", ventureId))
        .take(200);
    checkIns.sort((a, b) => b.createdAt - a.createdAt);
    const kpiTotal = checkIns.reduce((sum, row) => sum + row.value, 0);
    const kpiLatest = checkIns.length > 0 ? checkIns[0]!.value : 0;
    return { kpiTotal, kpiLatest, checkIns };
}

async function pledgedForVenture(ctx: DbCtx, ventureId: Id<"ventures">) {
    const commitments = await ctx.db
        .query("commitments")
        .withIndex("by_ventureId", (q) => q.eq("ventureId", ventureId))
        .take(100);
    return commitments.reduce((sum, row) => sum + row.amountKes, 0);
}

async function writeLedgerEvent(
    ctx: MutationCtx,
    args: {
        type: "pledge" | "checkin" | "digest" | "action" | "wisdom";
        ventureId?: Id<"ventures"> | null;
        commitmentId?: Id<"commitments"> | null;
        summary: string;
        amountKes?: number | null;
        metric?: string | null;
        value?: number | null;
        evidence?: string[];
        publicVisible?: boolean;
        createdAt: number;
    }
) {
    return await ctx.db.insert("ledgerEvents", {
        type: args.type,
        ventureId: args.ventureId ?? null,
        commitmentId: args.commitmentId ?? null,
        summary: args.summary,
        amountKes: args.amountKes ?? null,
        metric: args.metric ?? null,
        value: args.value ?? null,
        evidence: args.evidence,
        createdAt: args.createdAt,
        publicVisible: args.publicVisible ?? true,
    });
}

async function resolveDefaultInvestorId(ctx: DbCtx) {
    const demo = await ctx.db
        .query("investors")
        .withIndex("by_isDefaultDemo", (q) => q.eq("isDefaultDemo", true))
        .first();
    if (demo) return demo._id;
    const any = await ctx.db.query("investors").order("desc").first();
    return any?._id ?? null;
}

function uniqueSlugBase(name: string) {
    const base = normalizeKey(name).slice(0, 40) || "venture";
    return base;
}

async function allocatePublicSlug(ctx: DbCtx, name: string) {
    const base = uniqueSlugBase(name);
    let candidate = base;
    for (let i = 0; i < 12; i++) {
        const existing = await ctx.db
            .query("ventures")
            .withIndex("by_publicSlug", (q) => q.eq("publicSlug", candidate))
            .first();
        if (!existing) return candidate;
        candidate = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    }
    return `${base}-${Date.now().toString(36)}`;
}

async function upsertInvestorRecord(
    ctx: MutationCtx,
    args: { displayName: string; email?: string | null; phone?: string | null }
) {
    const displayName = args.displayName.trim() || "Investor";
    const email = args.email?.trim().toLowerCase() || null;
    const phone = args.phone?.trim() || null;
    const now = Date.now();

    if (email) {
        const existing = await ctx.db
            .query("investors")
            .withIndex("by_email", (q) => q.eq("email", email))
            .first();
        if (existing) {
            await ctx.db.patch(existing._id, {
                displayName: displayName || existing.displayName,
                phone: phone ?? existing.phone ?? null,
            });
            return existing._id;
        }
    }

    return await ctx.db.insert("investors", {
        displayName,
        email,
        phone,
        userId: null,
        isDefaultDemo: false,
        createdAt: now,
    });
}

export const upsertInvestor = mutation({
    args: {
        displayName: v.string(),
        email: v.optional(v.string()),
        phone: v.optional(v.string()),
    },
    returns: v.object({
        investorId: v.id("investors"),
        message: v.string(),
    }),
    handler: async (ctx, args) => {
        await rateLimiter.limit(ctx, "investMutate", { key: "investor" });
        const investorId = await upsertInvestorRecord(ctx, args);
        return { investorId, message: "Investor ready." };
    },
});

export const createVenture = mutation({
    args: {
        name: v.string(),
        craftText: v.string(),
        locationText: v.string(),
        summary: v.optional(v.string()),
        kpiLabel: v.string(),
        kpiUnit: kpiUnitValidator,
        kpiTarget: v.number(),
        peerMedian: v.optional(v.number()),
        publicSlug: v.optional(v.string()),
    },
    returns: v.object({
        ventureId: v.id("ventures"),
        publicSlug: v.string(),
        agentEmail: v.string(),
        message: v.string(),
    }),
    handler: async (ctx, args) => {
        await rateLimiter.limit(ctx, "investMutate", { key: "venture" });
        const name = args.name.trim();
        if (!name) throw new Error("Venture name is required");
        if (args.kpiTarget <= 0) throw new Error("kpiTarget must be positive");

        const craftText = args.craftText.trim() || "General";
        const locationText = args.locationText.trim() || "Kenya";
        const summary =
            args.summary?.trim() ||
            `${name} — soft revenue-share venture tracked on the public ledger.`;
        const now = Date.now();
        const publicSlug = args.publicSlug?.trim()
            ? normalizeKey(args.publicSlug)
            : await allocatePublicSlug(ctx, name);
        const agentEmail = `${publicSlug}@agent.juakali.demo`;

        const existingSlug = await ctx.db
            .query("ventures")
            .withIndex("by_publicSlug", (q) => q.eq("publicSlug", publicSlug))
            .first();
        if (existingSlug) throw new Error(`Slug "${publicSlug}" is already taken.`);

        const ventureId = await ctx.db.insert("ventures", {
            name,
            craftText,
            craftKey: normalizeKey(craftText),
            locationText,
            locationKey: normalizeKey(locationText),
            summary,
            kpiLabel: args.kpiLabel.trim() || "KPI",
            kpiUnit: args.kpiUnit,
            kpiTarget: Math.round(args.kpiTarget),
            peerMedian: args.peerMedian,
            agentEmail,
            publicSlug,
            masterId: null,
            apprenticeId: null,
            status: "active",
            createdAt: now,
            updatedAt: now,
        });

        return {
            ventureId,
            publicSlug,
            agentEmail,
            message: `Created ${name}.`,
        };
    },
});

/** Atomic first-deal path: investor + venture + soft pledge. */
export const startCommitment = mutation({
    args: {
        investorName: v.string(),
        investorEmail: v.optional(v.string()),
        ventureName: v.string(),
        craftText: v.string(),
        locationText: v.string(),
        summary: v.optional(v.string()),
        kpiLabel: v.string(),
        kpiUnit: kpiUnitValidator,
        kpiTarget: v.number(),
        peerMedian: v.optional(v.number()),
        amountKes: v.number(),
        shareBps: v.optional(v.number()),
        capMultiple: v.optional(v.number()),
        thesis: v.optional(v.string()),
    },
    returns: v.object({
        investorId: v.id("investors"),
        ventureId: v.id("ventures"),
        commitmentId: v.id("commitments"),
        publicSlug: v.string(),
        message: v.string(),
    }),
    handler: async (ctx, args) => {
        await assertCanAct(ctx);
        await rateLimiter.limit(ctx, "investMutate", { key: "startCommitment" });
        if (args.amountKes <= 0) throw new Error("amountKes must be positive");
        if (args.kpiTarget <= 0) throw new Error("kpiTarget must be positive");

        const investorId = await upsertInvestorRecord(ctx, {
            displayName: args.investorName,
            email: args.investorEmail,
        });

        const name = args.ventureName.trim();
        if (!name) throw new Error("Venture name is required");
        const craftText = args.craftText.trim() || "General";
        const locationText = args.locationText.trim() || "Kenya";
        const summary =
            args.summary?.trim() ||
            `${name} — soft revenue-share venture tracked on the public ledger.`;
        const now = Date.now();
        const publicSlug = await allocatePublicSlug(ctx, name);
        const agentEmail = `${publicSlug}@agent.juakali.demo`;

        const ventureId = await ctx.db.insert("ventures", {
            name,
            craftText,
            craftKey: normalizeKey(craftText),
            locationText,
            locationKey: normalizeKey(locationText),
            summary,
            kpiLabel: args.kpiLabel.trim() || "KPI",
            kpiUnit: args.kpiUnit,
            kpiTarget: Math.round(args.kpiTarget),
            peerMedian: args.peerMedian,
            agentEmail,
            publicSlug,
            masterId: null,
            apprenticeId: null,
            status: "active",
            createdAt: now,
            updatedAt: now,
        });

        const shareBps = args.shareBps ?? 1000;
        const capMultiple = args.capMultiple ?? 2;
        const thesis =
            args.thesis?.trim() ||
            `Soft revenue-share pledge into ${name}: ${(shareBps / 100).toFixed(1)}% of cashflow until ${capMultiple}×.`;

        const commitmentId = await ctx.db.insert("commitments", {
            investorId,
            ventureId,
            amountKes: Math.round(args.amountKes),
            shareBps,
            capMultiple,
            status: "pledged",
            thesis,
            nextDigestAt: nextFridayEightEAT(now),
            digestCadence: "Weekly · Fri 08:00 EAT",
            createdAt: now,
            updatedAt: now,
        });

        const investor = await ctx.db.get(investorId);
        await writeLedgerEvent(ctx, {
            type: "pledge",
            ventureId,
            commitmentId,
            summary: `${investor?.displayName ?? "Investor"} pledged KES ${Math.round(args.amountKes).toLocaleString()} into ${name} (${(shareBps / 100).toFixed(1)}% until ${capMultiple}×)`,
            amountKes: Math.round(args.amountKes),
            createdAt: now,
        });

        return {
            investorId,
            ventureId,
            commitmentId,
            publicSlug,
            message: `Commitment opened for ${name}.`,
        };
    },
});

export const getDeal = query({
    args: {
        commitmentId: v.optional(v.id("commitments")),
        ventureSlug: v.optional(v.string()),
    },
    returns: v.union(
        v.object({
            commitmentId: v.id("commitments"),
            investorId: v.id("investors"),
            ventureId: v.id("ventures"),
            amountKes: v.number(),
            status: commitmentStatusValidator,
            publicSlug: v.string(),
            ventureName: v.string(),
        }),
        v.null()
    ),
    handler: async (ctx, args) => {
        if (args.commitmentId) {
            const commitment = await ctx.db.get(args.commitmentId);
            if (!commitment) return null;
            const venture = await ctx.db.get(commitment.ventureId);
            if (!venture) return null;
            return {
                commitmentId: commitment._id,
                investorId: commitment.investorId,
                ventureId: commitment.ventureId,
                amountKes: commitment.amountKes,
                status: commitment.status,
                publicSlug: venture.publicSlug,
                ventureName: venture.name,
            };
        }
        if (args.ventureSlug) {
            const slug = normalizeKey(args.ventureSlug);
            const venture = await ctx.db
                .query("ventures")
                .withIndex("by_publicSlug", (q) => q.eq("publicSlug", slug))
                .first();
            if (!venture) return null;
            const commitment = await ctx.db
                .query("commitments")
                .withIndex("by_ventureId", (q) => q.eq("ventureId", venture._id))
                .order("desc")
                .first();
            if (!commitment) return null;
            return {
                commitmentId: commitment._id,
                investorId: commitment.investorId,
                ventureId: venture._id,
                amountKes: commitment.amountKes,
                status: commitment.status,
                publicSlug: venture.publicSlug,
                ventureName: venture.name,
            };
        }
        return null;
    },
});

export const publicLedger = query({
    args: {
        limit: v.optional(v.number()),
        /** Optional: restrict events to one venture (shareable deep link). */
        ventureSlug: v.optional(v.string()),
    },
    returns: v.object({
        events: v.array(
            v.object({
                id: v.id("ledgerEvents"),
                type: ledgerTypeValidator,
                summary: v.string(),
                amountKes: v.union(v.number(), v.null()),
                metric: v.union(v.string(), v.null()),
                value: v.union(v.number(), v.null()),
                evidence: v.array(v.string()),
                ventureName: v.union(v.string(), v.null()),
                ventureSlug: v.union(v.string(), v.null()),
                createdAt: v.number(),
                correlationId: v.union(v.string(), v.null()),
                runId: v.union(v.id("agentRuns"), v.null()),
                initiator: v.union(v.string(), v.null()),
                publicVisible: v.boolean(),
            })
        ),
        /** Ventures with at least one public event (filter chips). */
        ventures: v.array(
            v.object({
                id: v.id("ventures"),
                name: v.string(),
                slug: v.string(),
            })
        ),
        totals: v.object({
            pledgedKes: v.number(),
            checkIns: v.number(),
            activeVentures: v.number(),
            digests: v.number(),
        }),
    }),
    handler: async (ctx, args) => {
        const limit = Math.min(Math.max(args.limit ?? 40, 1), 100);
        const slug = args.ventureSlug ? normalizeKey(args.ventureSlug) : null;
        const filterVenture = slug
            ? await ctx.db
                  .query("ventures")
                  .withIndex("by_publicSlug", (q) => q.eq("publicSlug", slug))
                  .first()
            : null;
        if (slug && !filterVenture) {
            return { events: [], ventures: [], totals: { pledgedKes: 0, checkIns: 0, activeVentures: 0, digests: 0 } };
        }

        const rows = filterVenture
            ? await ctx.db
                  .query("ledgerEvents")
                  .withIndex("by_ventureId", (q) => q.eq("ventureId", filterVenture._id))
                  .order("desc")
                  .take(limit * 2)
            : await ctx.db.query("ledgerEvents").withIndex("by_createdAt").order("desc").take(limit * 2);
        const events = [];
        for (const row of rows) {
            if (!row.publicVisible) continue;
            const venture = row.ventureId ? await ctx.db.get(row.ventureId) : null;
            events.push({
                id: row._id,
                type: row.type,
                summary: row.summary,
                amountKes: row.amountKes ?? null,
                metric: row.metric ?? null,
                value: row.value ?? null,
                evidence: row.evidence ?? [],
                ventureName: venture?.name ?? null,
                ventureSlug: venture?.publicSlug ?? null,
                createdAt: row.createdAt,
                correlationId: row.correlationId ?? null,
                runId: row.runId ?? null,
                initiator: row.initiator ?? null,
                publicVisible: row.publicVisible,
            });
            if (events.length >= limit) break;
        }

        // Ventures that appear on the public ledger (filter chips) — one scan.
        const recentEvents = await ctx.db
            .query("ledgerEvents")
            .withIndex("by_createdAt")
            .order("desc")
            .take(400);
        const ventureIdsInOrder: Array<Id<"ventures">> = [];
        const seenVentures = new Set<string>();
        for (const event of recentEvents) {
            if (!event.publicVisible || !event.ventureId || seenVentures.has(event.ventureId)) continue;
            seenVentures.add(event.ventureId);
            ventureIdsInOrder.push(event.ventureId);
        }
        const ventures = [];
        for (const ventureId of ventureIdsInOrder) {
            const venture = await ctx.db.get(ventureId);
            if (venture) ventures.push({ id: venture._id, name: venture.name, slug: venture.publicSlug });
        }

        const commitments = await ctx.db.query("commitments").order("desc").take(200);
        const checkIns = await ctx.db.query("kpiCheckIns").order("desc").take(200);
        const activeVentureCount = await ctx.db
            .query("ventures")
            .withIndex("by_status", (q) => q.eq("status", "active"))
            .take(100);
        const digests = await ctx.db.query("agentDigests").order("desc").take(200);

        const scopedCommitments = filterVenture
            ? commitments.filter((row) => row.ventureId === filterVenture._id)
            : commitments;

        return {
            events,
            ventures,
            totals: {
                pledgedKes: scopedCommitments.reduce((sum, row) => sum + row.amountKes, 0),
                checkIns: filterVenture
                    ? checkIns.filter((row) => row.ventureId === filterVenture._id).length
                    : checkIns.length,
                activeVentures: filterVenture
                    ? filterVenture.status === "active"
                        ? 1
                        : 0
                    : activeVentureCount.length,
                digests: filterVenture
                    ? digests.filter((row) => row.ventureId === filterVenture._id).length
                    : digests.length,
            },
        };
    },
});

export const listVentures = query({
    args: {},
    returns: v.object({
        ventures: v.array(ventureSummaryValidator),
    }),
    handler: async (ctx) => {
        const ventures = await ctx.db.query("ventures").order("desc").take(50);
        const results = [];
        for (const venture of ventures) {
            const summary = await buildVentureSummary(ctx, venture._id);
            if (summary) results.push(summary);
        }
        return { ventures: results };
    },
});

export const investorCockpit = query({
    args: {
        investorId: v.optional(v.id("investors")),
        commitmentId: v.optional(v.id("commitments")),
        ventureSlug: v.optional(v.string()),
    },
    returns: v.object({
        investor: v.union(
            v.object({
                id: v.id("investors"),
                displayName: v.string(),
                email: v.union(v.string(), v.null()),
            }),
            v.null()
        ),
        focusCommitmentId: v.union(v.id("commitments"), v.null()),
        commitments: v.array(
            v.object({
                id: v.id("commitments"),
                amountKes: v.number(),
                shareBps: v.number(),
                capMultiple: v.number(),
                status: commitmentStatusValidator,
                thesis: v.string(),
                nextDigestAt: v.union(v.number(), v.null()),
                digestCadence: v.union(v.string(), v.null()),
                createdAt: v.number(),
                venture: ventureSummaryValidator,
                latestDigest: v.union(
                    v.object({
                        id: v.id("agentDigests"),
                        summary: v.string(),
                        insights: v.string(),
                        nextAction: v.union(v.string(), v.null()),
                        evidence: v.array(v.string()),
                        createdAt: v.number(),
                    }),
                    v.null()
                ),
                recentCheckIns: v.array(
                    v.object({
                        id: v.id("kpiCheckIns"),
                        periodLabel: v.string(),
                        metric: v.string(),
                        value: v.number(),
                        note: v.string(),
                        source: kpiSourceValidator,
                        createdAt: v.number(),
                    })
                ),
                recentEmails: v.array(
                    v.object({
                        id: v.id("agentEmails"),
                        direction: v.union(v.literal("inbound"), v.literal("outbound")),
                        fromAddress: v.string(),
                        toAddress: v.string(),
                        subject: v.string(),
                        body: v.string(),
                        createdAt: v.number(),
                    })
                ),
                /** Jua's proactive suggestion for this deal, awaiting approval. */
                openProposal: v.union(
                    v.object({
                        id: v.id("agentRuns"),
                        noteBody: v.string(),
                        subject: v.string(),
                        createdAt: v.number(),
                    }),
                    v.null()
                ),
            })
        ),
        availableVentures: v.array(ventureSummaryValidator),
        /** Agent presence — Jua is visibly alive between visits. */
        agentPresence: v.object({
            lastWorkedAt: v.union(v.number(), v.null()),
            runsThisWeek: v.number(),
            openProposals: v.number(),
        }),
    }),
    handler: async (ctx, args) => {
        // This query contains private commitments, emails, notes, and run
        // state. Never resolve an anonymous caller to the demo/default
        // investor, and never let an opaque commitment/investor id grant access.
        const userId = await getAuthUserId(ctx);
        const linkedInvestor = userId
            ? await ctx.db
                  .query("investors")
                  .withIndex("by_userId", (q) => q.eq("userId", userId))
                  .first()
            : null;
        let investorId: Id<"investors"> | null = linkedInvestor?._id ?? null;
        let focusCommitmentId: Id<"commitments"> | null = null;

        if (args.investorId) {
            if (!linkedInvestor || args.investorId !== linkedInvestor._id) {
                investorId = null;
            } else {
                investorId = args.investorId;
            }
        } else if (args.commitmentId) {
            const commitment = await ctx.db.get(args.commitmentId);
            if (!linkedInvestor || !commitment || commitment.investorId !== linkedInvestor._id) {
                investorId = null;
            } else {
                investorId = linkedInvestor._id;
                focusCommitmentId = commitment._id;
            }
        } else if (args.ventureSlug && linkedInvestor) {
            const slug = normalizeKey(args.ventureSlug);
            const venture = await ctx.db
                .query("ventures")
                .withIndex("by_publicSlug", (q) => q.eq("publicSlug", slug))
                .first();
            if (venture) {
                const commitments = await ctx.db
                    .query("commitments")
                    .withIndex("by_ventureId", (q) => q.eq("ventureId", venture._id))
                    .order("desc")
                    .take(20);
                const commitment = commitments.find(
                    (row) => row.investorId === linkedInvestor._id
                );
                if (commitment) focusCommitmentId = commitment._id;
            }
        }

        const investorDoc = investorId ? await ctx.db.get(investorId) : null;
        const investor = investorDoc
            ? {
                  id: investorDoc._id,
                  displayName: investorDoc.displayName,
                  email: investorDoc.email ?? null,
              }
            : null;

        const commitmentRows = investorId
            ? await ctx.db
                  .query("commitments")
                  .withIndex("by_investorId", (q) => q.eq("investorId", investorId!))
                  .order("desc")
                  .take(30)
            : [];

        const commitments = [];
        const now = Date.now();
        const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
        let lastWorkedAt: number | null = null;
        let runsThisWeek = 0;
        let openProposals = 0;

        for (const row of commitmentRows) {
            const ventureSummary = await buildVentureSummary(ctx, row.ventureId);
            if (!ventureSummary) continue;
            const { checkIns } = await sumVentureKpis(ctx, row.ventureId);
            const digests = await ctx.db
                .query("agentDigests")
                .withIndex("by_commitmentId", (q) => q.eq("commitmentId", row._id))
                .order("desc")
                .take(1);
            const latest = digests[0];
            const emails = await ctx.db
                .query("agentEmails")
                .withIndex("by_commitmentId", (q) => q.eq("commitmentId", row._id))
                .order("desc")
                .take(8);
            emails.sort((a, b) => a.createdAt - b.createdAt);

            // Jua's initiative: the pending proactive proposal for this deal,
            // plus presence stats (bounded scan per commitment).
            const proposalRuns = await ctx.db
                .query("agentRuns")
                .withIndex("by_commitmentId", (q) => q.eq("commitmentId", row._id))
                .order("desc")
                .take(20);
            let openProposal: {
                id: Id<"agentRuns">;
                noteBody: string;
                subject: string;
                createdAt: number;
            } | null = null;
            for (const run of proposalRuns) {
                if (run.status === "proposed" && run.actionPlan) {
                    openProposal ??= {
                        id: run._id,
                        noteBody: run.noteBody,
                        subject: run.subject,
                        createdAt: run.createdAt,
                    };
                    openProposals += 1;
                }
                if (run.status !== "dismissed") {
                    // Presence = real work: proposals alone don't count as "worked".
                    if (run.status !== "proposed" && (lastWorkedAt === null || run.updatedAt > lastWorkedAt)) {
                        lastWorkedAt = run.updatedAt;
                    }
                    if (run.createdAt >= weekAgo && run.status !== "proposed") runsThisWeek += 1;
                }
            }

            commitments.push({
                id: row._id,
                amountKes: row.amountKes,
                shareBps: row.shareBps,
                capMultiple: row.capMultiple,
                status: row.status,
                thesis: row.thesis,
                nextDigestAt: row.nextDigestAt ?? null,
                digestCadence: row.digestCadence ?? null,
                createdAt: row.createdAt,
                venture: ventureSummary,
                latestDigest: latest
                    ? {
                          id: latest._id,
                          summary: latest.summary,
                          insights: latest.insights,
                          nextAction: latest.nextAction ?? null,
                          evidence: latest.evidence ?? [],
                          createdAt: latest.createdAt,
                      }
                    : null,
                recentCheckIns: checkIns.slice(0, 5).map((checkIn) => ({
                    id: checkIn._id,
                    periodLabel: checkIn.periodLabel,
                    metric: checkIn.metric,
                    value: checkIn.value,
                    note: checkIn.note,
                    source: checkIn.source,
                    createdAt: checkIn.createdAt,
                })),
                recentEmails: emails.map((email) => ({
                    id: email._id,
                    direction: email.direction,
                    fromAddress: email.fromAddress,
                    toAddress: email.toAddress,
                    subject: email.subject,
                    body: email.body,
                    createdAt: email.createdAt,
                })),
                openProposal,
            });
        }

        const allVentures = await ctx.db.query("ventures").order("desc").take(30);
        const availableVentures = [];
        for (const venture of allVentures) {
            if (venture.status !== "active") continue;
            const summary = await buildVentureSummary(ctx, venture._id);
            if (summary) availableVentures.push(summary);
        }

        return {
            investor,
            focusCommitmentId: focusCommitmentId ?? commitments[0]?.id ?? null,
            commitments,
            availableVentures,
            agentPresence: {
                lastWorkedAt,
                runsThisWeek,
                openProposals,
            },
        };
    },
});

function planFromRun(run: Doc<"agentRuns">, ventureName: string) {
    // Single representation of the approval contract — shared with
    // agentRuns.getProposalDetail so inline and standalone approvals match.
    return planViewForRun(run, ventureName);
}

/** Empty private briefing for callers who have not linked an investor identity. */
function emptyTodayBriefing() {
    return {
        greetingName: null,
        briefingText: synthesizeBriefingText({
            firstName: null,
            needsDecision: 0,
            venturesMoved: 0,
            blocked: 0,
            decisionVenture: null,
        }),
        decision: null,
        completed: [],
        nextScheduled: null,
        stats: { needsDecision: 0, venturesMoved: 0, blocked: 0 },
        autonomyLevel: "ask_every_time" as const,
    };
}

/** Agent-led Today briefing: what happened, what needs a decision, what's next. */
export const todayBriefing = query({
    args: {
        investorId: v.optional(v.id("investors")),
    },
    returns: v.object({
        greetingName: v.union(v.string(), v.null()),
        briefingText: v.string(),
        decision: v.union(actionPlanViewValidator, v.null()),
        completed: v.array(
            v.object({
                title: v.string(),
                proofEventId: v.union(v.id("ledgerEvents"), v.null()),
                commitmentId: v.union(v.id("commitments"), v.null()),
                runId: v.union(v.id("agentRuns"), v.null()),
                at: v.number(),
            })
        ),
        nextScheduled: v.union(
            v.object({
                label: v.string(),
                at: v.number(),
            }),
            v.null()
        ),
        stats: v.object({
            needsDecision: v.number(),
            venturesMoved: v.number(),
            blocked: v.number(),
        }),
        autonomyLevel: autonomyLevelValidator,
    }),
    handler: async (ctx, args) => {
        const userId = await getAuthUserId(ctx);
        const linkedInvestor = userId
            ? await ctx.db
                  .query("investors")
                  .withIndex("by_userId", (q) => q.eq("userId", userId))
                  .first()
            : null;
        if (!linkedInvestor || (args.investorId && args.investorId !== linkedInvestor._id)) {
            return emptyTodayBriefing();
        }
        const investorId = linkedInvestor._id;
        const investor = await ctx.db.get(investorId);
        const greetingName = investor?.displayName?.split(/\s+/)[0] ?? null;
        const autonomyLevel = investor?.autonomyLevel ?? "ask_every_time";

        const commitments = await ctx.db
            .query("commitments")
            .withIndex("by_investorId", (q) => q.eq("investorId", investorId!))
            .order("desc")
            .take(30);

        const proposals: Array<{ run: Doc<"agentRuns">; ventureName: string; kpiLabel: string }> = [];
        const completed: Array<{
            title: string;
            proofEventId: Id<"ledgerEvents"> | null;
            commitmentId: Id<"commitments"> | null;
            runId: Id<"agentRuns"> | null;
            at: number;
        }> = [];
        let nextScheduled: { label: string; at: number } | null = null;
        const movedVentureIds = new Set<string>();
        let blocked = 0;
        const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

        for (const commitment of commitments) {
            const venture = await ctx.db.get(commitment.ventureId);
            const ventureName = venture?.name ?? "Venture";
            if (commitment.nextDigestAt != null) {
                if (!nextScheduled || commitment.nextDigestAt < nextScheduled.at) {
                    nextScheduled = {
                        label: `Jua checks for responses for ${ventureName}`,
                        at: commitment.nextDigestAt,
                    };
                }
            }

            const runs = await ctx.db
                .query("agentRuns")
                .withIndex("by_commitmentId", (q) => q.eq("commitmentId", commitment._id))
                .order("desc")
                .take(15);

            for (const run of runs) {
                if (run.status === "proposed" && run.actionPlan) {
                    proposals.push({ run, ventureName, kpiLabel: venture?.kpiLabel ?? "KPI" });
                } else if (run.status === "failed") {
                    blocked += 1;
                } else if (run.status === "completed" && run.updatedAt >= weekAgo) {
                    movedVentureIds.add(String(commitment.ventureId));
                    const ledger = await ctx.db
                        .query("ledgerEvents")
                        .withIndex("by_runId", (q) => q.eq("runId", run._id))
                        .order("desc")
                        .first();
                    completed.push({
                        title: run.result?.message || run.subject || `${ventureName} updated`,
                        proofEventId: ledger?._id ?? null,
                        commitmentId: commitment._id,
                        runId: run._id,
                        at: run.updatedAt,
                    });
                }
            }
        }

        proposals.sort((a, b) => a.run.createdAt - b.run.createdAt);
        completed.sort((a, b) => b.at - a.at);

        const top = proposals[0];
        const decision = top ? planFromRun(top.run, top.ventureName) : null;
        const needsDecision = proposals.length;
        const venturesMoved = movedVentureIds.size;

        return {
            greetingName,
            briefingText: synthesizeBriefingText({
                firstName: greetingName,
                needsDecision,
                venturesMoved,
                blocked,
                decisionVenture: decision?.ventureName ?? null,
            }),
            decision,
            completed: completed.slice(0, 8),
            nextScheduled,
            stats: { needsDecision, venturesMoved, blocked },
            autonomyLevel,
        };
    },
});

/** Does this investor own the commitment behind a ledger event? */
async function investorOwnsEvent(
    ctx: { db: QueryCtx["db"] },
    investorId: Id<"investors"> | null,
    event: Doc<"ledgerEvents">
): Promise<boolean> {
    if (!investorId || !event.commitmentId) return false;
    const commitment = await ctx.db.get(event.commitmentId);
    return commitment?.investorId === investorId;
}

/**
 * Single proof event + causal chain for detail screens.
 *
 * Fail-closed privacy:
 *  - Anonymous callers only ever see public events; a private root event is
 *    rejected outright and private chain members are filtered out.
 *  - Authenticated investors see private events ONLY for commitments they
 *    own (authorization by ownership, never by knowing an id).
 */
export const proofEvent = query({
    args: { eventId: v.id("ledgerEvents") },
    returns: v.union(
        v.null(),
        v.object({
            id: v.id("ledgerEvents"),
            type: ledgerTypeValidator,
            summary: v.string(),
            amountKes: v.union(v.number(), v.null()),
            metric: v.union(v.string(), v.null()),
            value: v.union(v.number(), v.null()),
            evidence: v.array(v.string()),
            ventureName: v.union(v.string(), v.null()),
            ventureSlug: v.union(v.string(), v.null()),
            createdAt: v.number(),
            publicVisible: v.boolean(),
            initiator: v.union(v.string(), v.null()),
            disputeState: v.union(v.string(), v.null()),
            runId: v.union(v.id("agentRuns"), v.null()),
            correlationId: v.union(v.string(), v.null()),
            /** The run whose approval authorized this effect, if any. */
            approvalRunId: v.union(v.id("agentRuns"), v.null()),
            parentEventId: v.union(v.id("ledgerEvents"), v.null()),
            chain: v.array(
                v.object({
                    id: v.id("ledgerEvents"),
                    type: ledgerTypeValidator,
                    summary: v.string(),
                    createdAt: v.number(),
                    initiator: v.union(v.string(), v.null()),
                    publicVisible: v.boolean(),
                    parentEventId: v.union(v.id("ledgerEvents"), v.null()),
                    approvalRunId: v.union(v.id("agentRuns"), v.null()),
                    /** True when an explicit parent edge makes this "caused by",
                     *  false when it is merely related activity in the chain. */
                    causedBy: v.boolean(),
                })
            ),
        })
    ),
    handler: async (ctx, args) => {
        const event = await ctx.db.get(args.eventId);
        if (!event) return null;

        // Resolve the caller's investor identity (null when anonymous).
        const userId = await getAuthUserId(ctx);
        let investorId: Id<"investors"> | null = null;
        if (userId) {
            const investor = await ctx.db
                .query("investors")
                .withIndex("by_userId", (q) => q.eq("userId", userId))
                .first();
            investorId = investor?._id ?? null;
        }

        // Fail closed: private root events require ownership.
        if (!event.publicVisible && !(await investorOwnsEvent(ctx, investorId, event))) {
            return null;
        }

        const venture = event.ventureId ? await ctx.db.get(event.ventureId) : null;
        let chainDocs = [event];
        if (event.correlationId) {
            const related = await ctx.db
                .query("ledgerEvents")
                .withIndex("by_correlationId", (q) => q.eq("correlationId", event.correlationId!))
                .order("asc")
                .take(20);
            if (related.length) chainDocs = related;
        } else if (event.runId) {
            const related = await ctx.db
                .query("ledgerEvents")
                .withIndex("by_runId", (q) => q.eq("runId", event.runId!))
                .order("asc")
                .take(20);
            if (related.length) chainDocs = related;
        }

        // Filter chain members: public always visible; private only if owned.
        const visibleChain: Doc<"ledgerEvents">[] = [];
        for (const row of chainDocs) {
            if (row.publicVisible || (await investorOwnsEvent(ctx, investorId, row))) {
                visibleChain.push(row);
            }
        }
        const visibleIds = new Set(visibleChain.map((row) => String(row._id)));

        return {
            id: event._id,
            type: event.type,
            summary: event.summary,
            amountKes: event.amountKes ?? null,
            metric: event.metric ?? null,
            value: event.value ?? null,
            evidence: event.evidence ?? [],
            ventureName: venture?.name ?? null,
            ventureSlug: venture?.publicSlug ?? null,
            createdAt: event.createdAt,
            publicVisible: event.publicVisible,
            initiator: event.initiator ?? null,
            disputeState: event.disputeState ?? "none",
            runId: event.runId ?? null,
            correlationId: event.correlationId ?? null,
            approvalRunId: event.approvalRunId ?? null,
            parentEventId: event.parentEventId ?? null,
            chain: visibleChain.map((row) => ({
                id: row._id,
                type: row.type,
                summary: row.summary,
                createdAt: row.createdAt,
                initiator: row.initiator ?? null,
                publicVisible: row.publicVisible,
                parentEventId: row.parentEventId ?? null,
                approvalRunId: row.approvalRunId ?? null,
                // "caused by" = explicit parent edge into a visible chain member;
                // otherwise it is merely related activity in the same run.
                causedBy:
                    row.parentEventId != null && visibleIds.has(String(row.parentEventId)),
            })),
        };
    },
});

export const setInvestorAutonomy = mutation({
    args: {
        investorId: v.optional(v.id("investors")),
        autonomyLevel: autonomyLevelValidator,
    },
    returns: v.object({ ok: v.boolean() }),
    handler: async (ctx, args) => {
        await assertCanAct(ctx);
        const investorId = args.investorId ?? (await resolveDefaultInvestorId(ctx));
        if (!investorId) throw new Error("Investor not found");
        await assertInvestorOwnsInvestor(ctx, investorId);
        await ctx.db.patch(investorId, { autonomyLevel: args.autonomyLevel });
        return { ok: true };
    },
});

export const pledgeCommitment = mutation({
    args: {
        investorId: v.optional(v.id("investors")),
        investorName: v.optional(v.string()),
        investorEmail: v.optional(v.string()),
        ventureId: v.id("ventures"),
        amountKes: v.number(),
        shareBps: v.optional(v.number()),
        capMultiple: v.optional(v.number()),
        thesis: v.optional(v.string()),
    },
    returns: v.object({
        commitmentId: v.id("commitments"),
        investorId: v.id("investors"),
        message: v.string(),
    }),
    handler: async (ctx, args) => {
        await assertCanAct(ctx);
        await rateLimiter.limit(ctx, "investMutate", { key: "pledge" });
        if (args.amountKes <= 0) throw new Error("amountKes must be positive");

        const venture = await ctx.db.get(args.ventureId);
        if (!venture) throw new Error("Venture not found");

        let investorId = args.investorId ?? null;
        if (!investorId && (args.investorName?.trim() || args.investorEmail?.trim())) {
            investorId = await upsertInvestorRecord(ctx, {
                displayName: args.investorName?.trim() || "Investor",
                email: args.investorEmail,
            });
        }
        if (!investorId) {
            investorId = await resolveDefaultInvestorId(ctx);
        }
        if (!investorId) {
            investorId = await upsertInvestorRecord(ctx, {
                displayName: "Investor",
                email: null,
            });
        }

        const investor = await ctx.db.get(investorId);
        if (!investor) throw new Error("Investor not found");

        const now = Date.now();
        const shareBps = args.shareBps ?? 1000;
        const capMultiple = args.capMultiple ?? 2;
        const thesis =
            args.thesis?.trim() ||
            `Soft revenue-share pledge into ${venture.name}: ${(shareBps / 100).toFixed(1)}% of cashflow until ${capMultiple}×.`;

        const commitmentId = await ctx.db.insert("commitments", {
            investorId,
            ventureId: args.ventureId,
            amountKes: Math.round(args.amountKes),
            shareBps,
            capMultiple,
            status: "pledged",
            thesis,
            nextDigestAt: nextFridayEightEAT(now),
            digestCadence: "Weekly · Fri 08:00 EAT",
            createdAt: now,
            updatedAt: now,
        });

        await writeLedgerEvent(ctx, {
            type: "pledge",
            ventureId: args.ventureId,
            commitmentId,
            summary: `${investor.displayName} pledged KES ${Math.round(args.amountKes).toLocaleString()} into ${venture.name} (${(shareBps / 100).toFixed(1)}% until ${capMultiple}×)`,
            amountKes: Math.round(args.amountKes),
            createdAt: now,
        });

        return {
            commitmentId,
            investorId,
            message: `Pledged KES ${Math.round(args.amountKes).toLocaleString()} into ${venture.name}.`,
        };
    },
});

export const logKpiCheckIn = mutation({
    args: {
        ventureId: v.optional(v.id("ventures")),
        ventureSlug: v.optional(v.string()),
        ventureName: v.optional(v.string()),
        commitmentId: v.optional(v.id("commitments")),
        periodLabel: v.optional(v.string()),
        metric: v.string(),
        value: v.number(),
        note: v.optional(v.string()),
        source: v.optional(kpiSourceValidator),
    },
    returns: v.object({
        checkInId: v.id("kpiCheckIns"),
        message: v.string(),
    }),
    handler: async (ctx, args) => {
        await rateLimiter.limit(ctx, "investMutate", { key: "kpi" });

        let ventureId = args.ventureId ?? null;
        if (!ventureId && args.ventureSlug) {
            const bySlug = await ctx.db
                .query("ventures")
                .withIndex("by_publicSlug", (q) => q.eq("publicSlug", args.ventureSlug!))
                .first();
            ventureId = bySlug?._id ?? null;
        }
        if (!ventureId && args.ventureName) {
            const needle = args.ventureName.trim().toLowerCase();
            const ventures = await ctx.db.query("ventures").order("desc").take(50);
            const match = ventures.find((row) => row.name.toLowerCase().includes(needle));
            ventureId = match?._id ?? null;
        }
        if (!ventureId) throw new Error("Venture not found. Pass ventureId, slug, or name.");

        const venture = await ctx.db.get(ventureId);
        if (!venture) throw new Error("Venture not found");

        const now = Date.now();
        const periodLabel = args.periodLabel?.trim() || `Week of ${new Date(now).toISOString().slice(0, 10)}`;
        const note = args.note?.trim() || "";
        const source = args.source ?? "agent";

        const checkInId = await ctx.db.insert("kpiCheckIns", {
            ventureId,
            commitmentId: args.commitmentId ?? null,
            periodLabel,
            metric: args.metric.trim(),
            value: args.value,
            note,
            source,
            createdAt: now,
        });

        await writeLedgerEvent(ctx, {
            type: "checkin",
            ventureId,
            commitmentId: args.commitmentId ?? null,
            summary: `${venture.name}: ${args.metric} = ${args.value}${note ? ` — ${note}` : ""}`,
            metric: args.metric.trim(),
            value: args.value,
            createdAt: now,
        });

        return {
            checkInId,
            message: `Logged ${args.metric}=${args.value} for ${venture.name}.`,
        };
    },
});

export const createDigest = mutation({
    args: {
        commitmentId: v.optional(v.id("commitments")),
        ventureId: v.optional(v.id("ventures")),
        ventureName: v.optional(v.string()),
        summary: v.string(),
        insights: v.string(),
    },
    returns: v.object({
        digestId: v.id("agentDigests"),
        message: v.string(),
    }),
    handler: async (ctx, args) => {
        await rateLimiter.limit(ctx, "investMutate", { key: "digest" });

        let commitmentId = args.commitmentId ?? null;
        let ventureId = args.ventureId ?? null;

        if (!commitmentId && !ventureId && args.ventureName) {
            const needle = args.ventureName.trim().toLowerCase();
            const ventures = await ctx.db.query("ventures").order("desc").take(50);
            const match = ventures.find((row) => row.name.toLowerCase().includes(needle));
            ventureId = match?._id ?? null;
        }

        if (!commitmentId && ventureId) {
            const commitment = await ctx.db
                .query("commitments")
                .withIndex("by_ventureId", (q) => q.eq("ventureId", ventureId!))
                .order("desc")
                .first();
            commitmentId = commitment?._id ?? null;
        }

        if (!commitmentId) {
            const investorId = await resolveDefaultInvestorId(ctx);
            if (investorId) {
                const commitment = await ctx.db
                    .query("commitments")
                    .withIndex("by_investorId", (q) => q.eq("investorId", investorId))
                    .order("desc")
                    .first();
                commitmentId = commitment?._id ?? null;
                if (!ventureId && commitment) ventureId = commitment.ventureId;
            }
        }

        if (!commitmentId) throw new Error("No commitment found. Pledge first or seed demo.");

        const commitment = await ctx.db.get(commitmentId);
        if (!commitment) throw new Error("Commitment not found");
        ventureId = ventureId ?? commitment.ventureId;
        const venture = await ctx.db.get(ventureId);
        if (!venture) throw new Error("Venture not found");

        const now = Date.now();
        const digestId = await ctx.db.insert("agentDigests", {
            commitmentId,
            ventureId,
            summary: args.summary.trim(),
            insights: args.insights.trim(),
            createdAt: now,
        });

        await writeLedgerEvent(ctx, {
            type: "digest",
            ventureId,
            commitmentId,
            summary: `Investor digest for ${venture.name}: ${args.summary.trim()}`,
            createdAt: now,
        });

        return {
            digestId,
            message: `Digest created for ${venture.name}.`,
        };
    },
});

export const seedInvestDemo = mutation({
    args: {},
    returns: v.object({
        createdInvestors: v.number(),
        createdVentures: v.number(),
        createdCommitments: v.number(),
        createdCheckIns: v.number(),
        createdDigests: v.number(),
        message: v.string(),
    }),
    handler: async (ctx) => {
        await assertCanAct(ctx);
        await rateLimiter.limit(ctx, "investMutate", { key: "seed" });
        const now = Date.now();

        const existingDefault = await ctx.db
            .query("investors")
            .withIndex("by_isDefaultDemo", (q) => q.eq("isDefaultDemo", true))
            .first();

        let createdInvestors = 0;
        let investorId = existingDefault?._id ?? null;
        if (!investorId) {
            investorId = await ctx.db.insert("investors", {
                displayName: "Wanjiru Kamau",
                email: "wanjiru@example.com",
                phone: "+254700111222",
                userId: null,
                isDefaultDemo: true,
                createdAt: now,
            });
            createdInvestors += 1;

            await ctx.db.insert("investors", {
                displayName: "James Otieno",
                email: "james@example.com",
                phone: "+254700333444",
                userId: null,
                isDefaultDemo: false,
                createdAt: now + 1,
            });
            createdInvestors += 1;
        }

        const seedVentures = [
            {
                name: "Amina Sales Pod",
                craftText: "Sales",
                locationText: "Nairobi",
                summary: "Field sales apprentice learning B2B outreach for SME software in Nairobi.",
                kpiLabel: "Meetings booked",
                kpiUnit: "meetings" as const,
                kpiTarget: 12,
                peerMedian: 4,
                agentEmail: "amina@agent.juakali.demo",
                publicSlug: "amina-sales-pod",
            },
            {
                name: "Brian Welding Bench",
                craftText: "Welding",
                locationText: "Kariobangi",
                summary: "Apprentice welder spinning up paid gate and grill jobs under a master in Kariobangi.",
                kpiLabel: "Jobs completed",
                kpiUnit: "jobs" as const,
                kpiTarget: 8,
                peerMedian: 3,
                agentEmail: "brian@agent.juakali.demo",
                publicSlug: "brian-welding-bench",
            },
            {
                name: "Faith Tailoring Line",
                craftText: "Tailoring",
                locationText: "Mombasa",
                summary: "Uniform and alteration microbusiness building weekly cashflow with a master tailor.",
                kpiLabel: "Revenue (KES)",
                kpiUnit: "revenue_kes" as const,
                kpiTarget: 25000,
                peerMedian: 12000,
                agentEmail: "faith@agent.juakali.demo",
                publicSlug: "faith-tailoring-line",
            },
        ];

        let createdVentures = 0;
        const ventureIds: Id<"ventures">[] = [];
        for (const seed of seedVentures) {
            const existing = await ctx.db
                .query("ventures")
                .withIndex("by_publicSlug", (q) => q.eq("publicSlug", seed.publicSlug))
                .first();
            if (existing) {
                ventureIds.push(existing._id);
                continue;
            }
            const id = await ctx.db.insert("ventures", {
                name: seed.name,
                craftText: seed.craftText,
                craftKey: normalizeKey(seed.craftText),
                locationText: seed.locationText,
                locationKey: normalizeKey(seed.locationText),
                summary: seed.summary,
                kpiLabel: seed.kpiLabel,
                kpiUnit: seed.kpiUnit,
                kpiTarget: seed.kpiTarget,
                peerMedian: seed.peerMedian,
                agentEmail: seed.agentEmail,
                publicSlug: seed.publicSlug,
                masterId: null,
                apprenticeId: null,
                status: "active",
                createdAt: now + createdVentures,
                updatedAt: now + createdVentures,
            });
            ventureIds.push(id);
            createdVentures += 1;
        }

        const existingCommitments = await ctx.db
            .query("commitments")
            .withIndex("by_investorId", (q) => q.eq("investorId", investorId!))
            .take(10);

        let createdCommitments = 0;
        let createdCheckIns = 0;
        let createdDigests = 0;
        const commitmentIds: Id<"commitments">[] = [];

        if (existingCommitments.length === 0) {
            const pledges = [
                {
                    ventureId: ventureIds[0]!,
                    amountKes: 15000,
                    shareBps: 1000,
                    thesis: "Back Amina’s outbound week — pay for airtime + CRM coaching; share 10% of sales cashflow until 2×.",
                    // Backdated activity → Jua has an honest reason to follow up.
                    backdateDays: 3,
                    checkIns: [
                        { metric: "meetings_booked", value: 4, note: "Two SME owners + one clinic admin", periodLabel: "Week 1" },
                        { metric: "meetings_booked", value: 6, note: "Pipeline filling; one verbal yes", periodLabel: "Week 2" },
                    ],
                    digest: {
                        summary: "I watched Amina book 10 meetings across two weeks; one verbal commitment is pending a quote.",
                        insights: "Airtime spend is the bottleneck. I recommend a KES 2,000 top-up and a fixed Tuesday review call.",
                    },
                },
                {
                    ventureId: ventureIds[1]!,
                    amountKes: 20000,
                    shareBps: 800,
                    thesis: "Fund Brian’s consumables + PPE; 8% of job revenue until 2×.",
                    backdateDays: 0,
                    checkIns: [
                        { metric: "jobs_completed", value: 2, note: "Gate repair + grill install", periodLabel: "Week 1" },
                        { metric: "revenue_kes", value: 7800, note: "Collected via M-Pesa", periodLabel: "Week 1" },
                    ],
                    digest: {
                        summary: "Two paid jobs completed; I logged KES 7,800 collected. Consumables still thin.",
                        insights: "Next week I'll push quote discipline and photo evidence of each job for the public ledger.",
                    },
                },
            ];

            for (const pledge of pledges) {
                // Backdated activity reads honestly ("last reported 3 days ago")
                // and gives Jua a real reason to follow up on first visit.
                const baseTs = now - (pledge.backdateDays ?? 0) * 24 * 60 * 60 * 1000;
                const commitmentId = await ctx.db.insert("commitments", {
                    investorId: investorId!,
                    ventureId: pledge.ventureId,
                    amountKes: pledge.amountKes,
                    shareBps: pledge.shareBps,
                    capMultiple: 2,
                    status: "active",
                    thesis: pledge.thesis,
                    nextDigestAt: nextFridayEightEAT(now),
                    digestCadence: "Weekly · Fri 08:00 EAT",
                    createdAt: baseTs + createdCommitments,
                    updatedAt: baseTs + createdCommitments,
                });
                commitmentIds.push(commitmentId);
                createdCommitments += 1;

                const venture = await ctx.db.get(pledge.ventureId);
                const investorEmail = "wanjiru@example.com";
                const agentAddress = venture?.agentEmail ?? "agent@juakali.demo";
                await writeLedgerEvent(ctx, {
                    type: "pledge",
                    ventureId: pledge.ventureId,
                    commitmentId,
                    summary: `Wanjiru Kamau pledged KES ${pledge.amountKes.toLocaleString()} into ${venture?.name ?? "venture"} (${(pledge.shareBps / 100).toFixed(1)}% until 2×)`,
                    amountKes: pledge.amountKes,
                    createdAt: baseTs + createdCommitments,
                });

                for (const checkIn of pledge.checkIns) {
                    await ctx.db.insert("kpiCheckIns", {
                        ventureId: pledge.ventureId,
                        commitmentId,
                        periodLabel: checkIn.periodLabel,
                        metric: checkIn.metric,
                        value: checkIn.value,
                        note: checkIn.note,
                        source: "agent",
                        createdAt: baseTs + createdCheckIns + 10,
                    });
                    await writeLedgerEvent(ctx, {
                        type: "checkin",
                        ventureId: pledge.ventureId,
                        commitmentId,
                        summary: `${venture?.name}: ${checkIn.metric} = ${checkIn.value} — ${checkIn.note}`,
                        metric: checkIn.metric,
                        value: checkIn.value,
                        createdAt: baseTs + createdCheckIns + 11,
                    });
                    createdCheckIns += 1;
                }

                await ctx.db.insert("agentDigests", {
                    commitmentId,
                    ventureId: pledge.ventureId,
                    summary: pledge.digest.summary,
                    insights: pledge.digest.insights,
                    createdAt: baseTs + createdDigests + 20,
                });
                await writeLedgerEvent(ctx, {
                    type: "digest",
                    ventureId: pledge.ventureId,
                    commitmentId,
                    summary: `Digest for ${venture?.name}: ${pledge.digest.summary}`,
                    createdAt: baseTs + createdDigests + 21,
                });
                createdDigests += 1;

                await ctx.db.insert("agentEmails", {
                    commitmentId,
                    ventureId: pledge.ventureId,
                    investorId: investorId!,
                    direction: "inbound",
                    fromAddress: investorEmail,
                    toAddress: agentAddress,
                    subject: `Re: ${venture?.name ?? "venture"} — quick push`,
                    body: `Please push follow-ups this week and summarize pipeline for me by Friday.`,
                    createdAt: baseTs + 30,
                });
                await ctx.db.insert("agentEmails", {
                    commitmentId,
                    ventureId: pledge.ventureId,
                    investorId: investorId!,
                    direction: "outbound",
                    fromAddress: agentAddress,
                    toAddress: investorEmail,
                    subject: `Digest: ${venture?.name ?? "venture"}`,
                    body: `${pledge.digest.summary}\n\n${pledge.digest.insights}\n\n— Jua · JuaKali agent (demo email ritual)`,
                    createdAt: baseTs + 31,
                });

                // Jua takes initiative: a real open proposal on the stale venture.
                if ((pledge.backdateDays ?? 0) > 0 && venture) {
                    const commitmentDoc = await ctx.db.get(commitmentId);
                    if (commitmentDoc) {
                        await createProposalForCommitment(ctx, commitmentDoc, venture, pledge.backdateDays!);
                    }
                }
            }

            // Third venture visible but not yet pledged by default investor
            await writeLedgerEvent(ctx, {
                type: "action",
                ventureId: ventureIds[2]!,
                summary: "Faith Tailoring Line listed for public investment — seeking first soft pledge for machine servicing.",
                createdAt: now + 50,
            });

            // The wisdom loop has history too: a mentor's applied note with a
            // measured outcome, so both sides of the loop demo truthfully.
            const existingWisdom = await ctx.db
                .query("sharedItems")
                .withIndex("by_ventureId_and_status", (q) =>
                    q.eq("ventureId", ventureIds[0]!).eq("status", "applied")
                )
                .first();
            if (!existingWisdom) {
                const appliedAt = now - 4 * 24 * 60 * 60 * 1000;
                await ctx.db.insert("sharedItems", {
                    ventureId: ventureIds[0]!,
                    investorId,
                    kind: "note",
                    sourceUrl: null,
                    title: "Note from your mentor",
                    body: "Stop selling to everyone. Pick the clinic admins you already met — they know you. Ask each for one referral before Friday and write down who said what.",
                    charCount: 160,
                    status: "applied",
                    parse: {
                        summary: "Focus the week on referral selling through warm clinic-admin contacts instead of cold outreach.",
                        principles: [
                            "Warm referrals close faster than cold outreach",
                            "Ask for one referral per existing contact",
                            "Write down every answer — pipeline memory",
                        ],
                        application: {
                            title: "Run the referral sweep this week",
                            body: "List the clinic admins already met, ask each for one referral before Friday, and log every answer. Jua will measure meetings booked against this and report the delta to your mentor.",
                        },
                        confidence: 0.82,
                        engine: "fallback",
                    },
                    appliedAt,
                    createdAt: appliedAt - 3600_000,
                });
                await writeLedgerEvent(ctx, {
                    type: "wisdom",
                    ventureId: ventureIds[0]!,
                    commitmentId: null,
                    summary: "Wanjiru Kamau shared a note with Amina Sales Pod — Jua applied: Run the referral sweep this week",
                    createdAt: appliedAt,
                    evidence: ["agent", "note"],
                });
            }
        }

        const alreadySeeded =
            createdInvestors === 0 &&
            createdVentures === 0 &&
            createdCommitments === 0 &&
            createdCheckIns === 0 &&
            createdDigests === 0;

        return {
            createdInvestors,
            createdVentures,
            createdCommitments,
            createdCheckIns,
            createdDigests,
            message: alreadySeeded ? "Invest demo already seeded" : "Invest demo seeded",
        };
    },
});

async function resolveVentureId(
    ctx: DbCtx,
    args: { ventureId?: Id<"ventures">; ventureSlug?: string; ventureName?: string }
): Promise<Id<"ventures"> | null> {
    if (args.ventureId) return args.ventureId;
    if (args.ventureSlug) {
        const bySlug = await ctx.db
            .query("ventures")
            .withIndex("by_publicSlug", (q) => q.eq("publicSlug", args.ventureSlug!))
            .first();
        if (bySlug) return bySlug._id;
    }
    if (args.ventureName) {
        const needle = args.ventureName.trim().toLowerCase();
        const ventures = await ctx.db.query("ventures").order("desc").take(50);
        const match = ventures.find((row) => row.name.toLowerCase().includes(needle));
        if (match) return match._id;
    }
    return null;
}

function extractEmailAddress(raw: string): string {
    const angle = raw.match(/<([^>]+)>/);
    if (angle?.[1]) return angle[1].trim().toLowerCase();
    return raw.trim().toLowerCase();
}

/**
 * Inbound AgentMail → durable run. Same pipeline as approve & run, so the
 * cockpit streams truthful progress for email-triggered agent work too.
 * Idempotent on Svix `eventId` (provider retries).
 */
export const handleAgentMailInbound = mutation({
    args: {
        toAddress: v.string(),
        fromAddress: v.string(),
        subject: v.optional(v.string()),
        body: v.string(),
        eventId: v.optional(v.string()),
    },
    returns: v.object({
        ok: v.boolean(),
        message: v.string(),
        commitmentId: v.union(v.id("commitments"), v.null()),
        runId: v.union(v.id("agentRuns"), v.null()),
    }),
    handler: async (ctx, args) => {
        await rateLimiter.limit(ctx, "investMutate", { key: "agentmail" });

        // Dedupe provider webhook retries.
        if (args.eventId) {
            const seen = await ctx.db
                .query("processedWebhooks")
                .withIndex("by_key", (q) => q.eq("key", `agentmail:${args.eventId}`))
                .first();
            if (seen) {
                return {
                    ok: true,
                    message: "Duplicate webhook ignored",
                    commitmentId: null,
                    runId: null,
                };
            }
            await ctx.db.insert("processedWebhooks", {
                key: `agentmail:${args.eventId}`,
                channel: "agentmail",
                reply: "",
                createdAt: Date.now(),
            });
        }

        const to = extractEmailAddress(args.toAddress);
        const from = extractEmailAddress(args.fromAddress);
        const body = (args.body || "").trim();
        if (!body) {
            return { ok: false, message: "Empty body", commitmentId: null, runId: null };
        }

        let venture =
            (await ctx.db
                .query("ventures")
                .withIndex("by_agentEmail", (q) => q.eq("agentEmail", to))
                .first()) ?? null;
        if (!venture) {
            const local = to.split("@")[0] ?? "";
            venture =
                (await ctx.db
                    .query("ventures")
                    .withIndex("by_publicSlug", (q) => q.eq("publicSlug", local))
                    .first()) ?? null;
        }
        // Shared AgentMail inbox: resolve venture from subject "venture:<slug>" or "[slug]"
        if (!venture && args.subject) {
            const subj = args.subject;
            const tagged =
                subj.match(/venture:\s*([a-z0-9-]+)/i)?.[1] ??
                subj.match(/\[([a-z0-9-]+)\]/i)?.[1] ??
                null;
            if (tagged) {
                venture =
                    (await ctx.db
                        .query("ventures")
                        .withIndex("by_publicSlug", (q) => q.eq("publicSlug", tagged.toLowerCase()))
                        .first()) ?? null;
            }
        }
        // Fallback: investor email → their latest commitment's venture
        if (!venture) {
            const investorByEmail = await ctx.db
                .query("investors")
                .withIndex("by_email", (q) => q.eq("email", from))
                .first();
            if (investorByEmail) {
                const commitment = await ctx.db
                    .query("commitments")
                    .withIndex("by_investorId", (q) => q.eq("investorId", investorByEmail._id))
                    .order("desc")
                    .first();
                if (commitment) {
                    venture = await ctx.db.get(commitment.ventureId);
                }
            }
        }
        if (!venture) {
            return {
                ok: false,
                message: `No venture for inbox ${to}`,
                commitmentId: null,
                runId: null,
            };
        }

        let commitment = await ctx.db
            .query("commitments")
            .withIndex("by_ventureId", (q) => q.eq("ventureId", venture!._id))
            .order("desc")
            .first();

        if (!commitment) {
            const investorByEmail = await ctx.db
                .query("investors")
                .withIndex("by_email", (q) => q.eq("email", from))
                .first();
            const investorId = investorByEmail?._id ?? (await resolveDefaultInvestorId(ctx));
            if (!investorId) {
                return {
                    ok: false,
                    message: "No investor to attach commitment",
                    commitmentId: null,
                    runId: null,
                };
            }
            const now = Date.now();
            const commitmentId = await ctx.db.insert("commitments", {
                investorId,
                ventureId: venture._id,
                amountKes: 0,
                shareBps: 1000,
                capMultiple: 2,
                status: "active",
                thesis: "Opened via AgentMail inbound (soft commitment pending formal pledge).",
                nextDigestAt: nextFridayEightEAT(now),
                digestCadence: "Weekly · Fri 08:00 EAT",
                createdAt: now,
                updatedAt: now,
            });
            commitment = await ctx.db.get(commitmentId);
        }

        if (!commitment) {
            return { ok: false, message: "Could not resolve commitment", commitmentId: null, runId: null };
        }

        const run = await createAgentRun(ctx, {
            commitmentId: commitment._id,
            noteBody: body,
            subject: args.subject,
            trigger: "inbound_email",
            source: "email_paste",
            fromAddressOverride: from,
            toAddressOverride: to,
        });

        return {
            ok: true,
            message: `Agent run started for ${venture.name}${args.eventId ? ` (event ${args.eventId})` : ""}.`,
            commitmentId: commitment._id,
            runId: run.runId,
        };
    },
});


// MCP / agent wrappers (name/slug-friendly)

export const listVenturesViaMcp = query({
    args: {},
    returns: v.object({
        ventures: v.array(ventureSummaryValidator),
    }),
    handler: async (ctx) => {
        const ventures = await ctx.db.query("ventures").order("desc").take(50);
        const results = [];
        for (const venture of ventures) {
            const summary = await buildVentureSummary(ctx, venture._id);
            if (summary) results.push(summary);
        }
        return { ventures: results };
    },
});

export const getPublicLedgerViaMcp = query({
    args: { limit: v.optional(v.number()) },
    returns: v.object({
        events: v.array(
            v.object({
                id: v.id("ledgerEvents"),
                type: ledgerTypeValidator,
                summary: v.string(),
                amountKes: v.union(v.number(), v.null()),
                metric: v.union(v.string(), v.null()),
                value: v.union(v.number(), v.null()),
                ventureName: v.union(v.string(), v.null()),
                ventureSlug: v.union(v.string(), v.null()),
                createdAt: v.number(),
            })
        ),
        totals: v.object({
            pledgedKes: v.number(),
            checkIns: v.number(),
            activeVentures: v.number(),
            digests: v.number(),
        }),
    }),
    handler: async (ctx, args) => {
        const limit = Math.min(Math.max(args.limit ?? 40, 1), 100);
        const rows = await ctx.db.query("ledgerEvents").withIndex("by_createdAt").order("desc").take(limit * 2);
        const events = [];
        for (const row of rows) {
            if (!row.publicVisible) continue;
            const venture = row.ventureId ? await ctx.db.get(row.ventureId) : null;
            events.push({
                id: row._id,
                type: row.type,
                summary: row.summary,
                amountKes: row.amountKes ?? null,
                metric: row.metric ?? null,
                value: row.value ?? null,
                ventureName: venture?.name ?? null,
                ventureSlug: venture?.publicSlug ?? null,
                createdAt: row.createdAt,
            });
            if (events.length >= limit) break;
        }

        const commitments = await ctx.db.query("commitments").order("desc").take(200);
        const checkIns = await ctx.db.query("kpiCheckIns").order("desc").take(200);
        const ventures = await ctx.db
            .query("ventures")
            .withIndex("by_status", (q) => q.eq("status", "active"))
            .take(100);
        const digests = await ctx.db.query("agentDigests").order("desc").take(200);

        return {
            events,
            totals: {
                pledgedKes: commitments.reduce((sum, row) => sum + row.amountKes, 0),
                checkIns: checkIns.length,
                activeVentures: ventures.length,
                digests: digests.length,
            },
        };
    },
});

export const pledgeViaMcp = mutation({
    args: {
        ventureId: v.optional(v.id("ventures")),
        ventureSlug: v.optional(v.string()),
        ventureName: v.optional(v.string()),
        amountKes: v.number(),
        shareBps: v.optional(v.number()),
        capMultiple: v.optional(v.number()),
        thesis: v.optional(v.string()),
    },
    returns: v.object({
        commitmentId: v.id("commitments"),
        message: v.string(),
    }),
    handler: async (ctx, args) => {
        await rateLimiter.limit(ctx, "investMutate", { key: "pledgeViaMcp" });
        if (args.amountKes <= 0) throw new Error("amountKes must be positive");

        const ventureId = await resolveVentureId(ctx, args);
        if (!ventureId) throw new Error("Venture not found");

        const venture = await ctx.db.get(ventureId);
        if (!venture) throw new Error("Venture not found");

        let investorId = await resolveDefaultInvestorId(ctx);
        if (!investorId) {
            investorId = await upsertInvestorRecord(ctx, {
                displayName: "Investor",
                email: null,
            });
        }
        const investor = await ctx.db.get(investorId);
        if (!investor) throw new Error("Investor not found");

        const now = Date.now();
        const shareBps = args.shareBps ?? 1000;
        const capMultiple = args.capMultiple ?? 2;
        const thesis =
            args.thesis?.trim() ||
            `Soft revenue-share pledge into ${venture.name}: ${(shareBps / 100).toFixed(1)}% of cashflow until ${capMultiple}×.`;

        const commitmentId = await ctx.db.insert("commitments", {
            investorId,
            ventureId,
            amountKes: Math.round(args.amountKes),
            shareBps,
            capMultiple,
            status: "pledged",
            thesis,
            nextDigestAt: nextFridayEightEAT(now),
            digestCadence: "Weekly · Fri 08:00 EAT",
            createdAt: now,
            updatedAt: now,
        });

        await writeLedgerEvent(ctx, {
            type: "pledge",
            ventureId,
            commitmentId,
            summary: `${investor.displayName} pledged KES ${Math.round(args.amountKes).toLocaleString()} into ${venture.name} (${(shareBps / 100).toFixed(1)}% until ${capMultiple}×)`,
            amountKes: Math.round(args.amountKes),
            createdAt: now,
        });

        return {
            commitmentId,
            message: `Pledged KES ${Math.round(args.amountKes).toLocaleString()} into ${venture.name}.`,
        };
    },
});

export const logKpiViaMcp = mutation({
    args: {
        ventureId: v.optional(v.id("ventures")),
        ventureSlug: v.optional(v.string()),
        ventureName: v.optional(v.string()),
        periodLabel: v.optional(v.string()),
        metric: v.string(),
        value: v.number(),
        note: v.optional(v.string()),
        source: v.optional(kpiSourceValidator),
    },
    returns: v.object({
        checkInId: v.id("kpiCheckIns"),
        message: v.string(),
    }),
    handler: async (ctx, args) => {
        await rateLimiter.limit(ctx, "investMutate", { key: "kpiViaMcp" });
        const ventureId = await resolveVentureId(ctx, args);
        if (!ventureId) throw new Error("Venture not found. Pass ventureId, slug, or name.");

        const venture = await ctx.db.get(ventureId);
        if (!venture) throw new Error("Venture not found");

        const now = Date.now();
        const periodLabel = args.periodLabel?.trim() || `Week of ${new Date(now).toISOString().slice(0, 10)}`;
        const note = args.note?.trim() || "";
        const source = args.source ?? "agent";

        const checkInId = await ctx.db.insert("kpiCheckIns", {
            ventureId,
            commitmentId: null,
            periodLabel,
            metric: args.metric.trim(),
            value: args.value,
            note,
            source,
            createdAt: now,
        });

        await writeLedgerEvent(ctx, {
            type: "checkin",
            ventureId,
            commitmentId: null,
            summary: `${venture.name}: ${args.metric} = ${args.value}${note ? ` — ${note}` : ""}`,
            metric: args.metric.trim(),
            value: args.value,
            createdAt: now,
        });

        return {
            checkInId,
            message: `Logged ${args.metric}=${args.value} for ${venture.name}.`,
        };
    },
});

export const createDigestViaMcp = mutation({
    args: {
        commitmentId: v.optional(v.id("commitments")),
        ventureId: v.optional(v.id("ventures")),
        ventureName: v.optional(v.string()),
        summary: v.string(),
        insights: v.string(),
    },
    returns: v.object({
        digestId: v.id("agentDigests"),
        message: v.string(),
    }),
    handler: async (ctx, args) => {
        await rateLimiter.limit(ctx, "investMutate", { key: "digestViaMcp" });

        let commitmentId = args.commitmentId ?? null;
        let ventureId = args.ventureId ?? (await resolveVentureId(ctx, { ventureName: args.ventureName }));

        if (!commitmentId && ventureId) {
            const commitment = await ctx.db
                .query("commitments")
                .withIndex("by_ventureId", (q) => q.eq("ventureId", ventureId!))
                .order("desc")
                .first();
            commitmentId = commitment?._id ?? null;
        }

        if (!commitmentId) {
            const investorId = await resolveDefaultInvestorId(ctx);
            if (investorId) {
                const commitment = await ctx.db
                    .query("commitments")
                    .withIndex("by_investorId", (q) => q.eq("investorId", investorId))
                    .order("desc")
                    .first();
                commitmentId = commitment?._id ?? null;
                if (!ventureId && commitment) ventureId = commitment.ventureId;
            }
        }

        if (!commitmentId) throw new Error("No commitment found. Pledge first or seed demo.");
        const commitment = await ctx.db.get(commitmentId);
        if (!commitment) throw new Error("Commitment not found");
        ventureId = ventureId ?? commitment.ventureId;
        const venture = await ctx.db.get(ventureId);
        if (!venture) throw new Error("Venture not found");

        const now = Date.now();
        const digestId = await ctx.db.insert("agentDigests", {
            commitmentId,
            ventureId,
            summary: args.summary.trim(),
            insights: args.insights.trim(),
            createdAt: now,
        });

        await writeLedgerEvent(ctx, {
            type: "digest",
            ventureId,
            commitmentId,
            summary: `Investor digest for ${venture.name}: ${args.summary.trim()}`,
            createdAt: now,
        });

        return {
            digestId,
            message: `Digest created for ${venture.name}.`,
        };
    },
});
