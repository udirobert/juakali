import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { rateLimiter } from "./rateLimit";
import { normalizeKey } from "./juaKaliHelpers";

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
    v.literal("email_paste")
);
const ledgerTypeValidator = v.union(
    v.literal("pledge"),
    v.literal("checkin"),
    v.literal("digest"),
    v.literal("action")
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
        type: "pledge" | "checkin" | "digest" | "action";
        ventureId?: Id<"ventures"> | null;
        commitmentId?: Id<"commitments"> | null;
        summary: string;
        amountKes?: number | null;
        metric?: string | null;
        value?: number | null;
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
            })
        ),
        availableVentures: v.array(ventureSummaryValidator),
    }),
    handler: async (ctx, args) => {
        let investorId = args.investorId ?? null;
        let focusCommitmentId: typeof args.commitmentId | null = args.commitmentId ?? null;

        if (!investorId && args.commitmentId) {
            const commitment = await ctx.db.get(args.commitmentId);
            if (commitment) {
                investorId = commitment.investorId;
                focusCommitmentId = commitment._id;
            }
        }

        if (!investorId && args.ventureSlug) {
            const slug = normalizeKey(args.ventureSlug);
            const venture = await ctx.db
                .query("ventures")
                .withIndex("by_publicSlug", (q) => q.eq("publicSlug", slug))
                .first();
            if (venture) {
                const commitment = await ctx.db
                    .query("commitments")
                    .withIndex("by_ventureId", (q) => q.eq("ventureId", venture._id))
                    .order("desc")
                    .first();
                if (commitment) {
                    investorId = commitment.investorId;
                    focusCommitmentId = commitment._id;
                }
            }
        }

        if (!investorId) {
            investorId = await resolveDefaultInvestorId(ctx);
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
        };
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
                    checkIns: [
                        { metric: "meetings_booked", value: 4, note: "Two SME owners + one clinic admin", periodLabel: "Week 1" },
                        { metric: "meetings_booked", value: 6, note: "Pipeline filling; one verbal yes", periodLabel: "Week 2" },
                    ],
                    digest: {
                        summary: "Amina booked 10 meetings across two weeks; one verbal commitment pending quote.",
                        insights: "Airtime spend is the bottleneck. Recommend KES 2,000 top-up and a fixed Tuesday review call.",
                    },
                },
                {
                    ventureId: ventureIds[1]!,
                    amountKes: 20000,
                    shareBps: 800,
                    thesis: "Fund Brian’s consumables + PPE; 8% of job revenue until 2×.",
                    checkIns: [
                        { metric: "jobs_completed", value: 2, note: "Gate repair + grill install", periodLabel: "Week 1" },
                        { metric: "revenue_kes", value: 7800, note: "Collected via M-Pesa", periodLabel: "Week 1" },
                    ],
                    digest: {
                        summary: "Two paid jobs completed; KES 7,800 collected. Consumables still thin.",
                        insights: "Next week focus: quote discipline and photo evidence of each job for the public ledger.",
                    },
                },
            ];

            for (const pledge of pledges) {
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
                    createdAt: now + createdCommitments,
                    updatedAt: now + createdCommitments,
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
                    createdAt: now + createdCommitments,
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
                        createdAt: now + createdCheckIns + 10,
                    });
                    await writeLedgerEvent(ctx, {
                        type: "checkin",
                        ventureId: pledge.ventureId,
                        commitmentId,
                        summary: `${venture?.name}: ${checkIn.metric} = ${checkIn.value} — ${checkIn.note}`,
                        metric: checkIn.metric,
                        value: checkIn.value,
                        createdAt: now + createdCheckIns + 11,
                    });
                    createdCheckIns += 1;
                }

                await ctx.db.insert("agentDigests", {
                    commitmentId,
                    ventureId: pledge.ventureId,
                    summary: pledge.digest.summary,
                    insights: pledge.digest.insights,
                    createdAt: now + createdDigests + 20,
                });
                await writeLedgerEvent(ctx, {
                    type: "digest",
                    ventureId: pledge.ventureId,
                    commitmentId,
                    summary: `Investor digest for ${venture?.name}: ${pledge.digest.summary}`,
                    createdAt: now + createdDigests + 21,
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
                    createdAt: now + 30,
                });
                await ctx.db.insert("agentEmails", {
                    commitmentId,
                    ventureId: pledge.ventureId,
                    investorId: investorId!,
                    direction: "outbound",
                    fromAddress: agentAddress,
                    toAddress: investorEmail,
                    subject: `Digest: ${venture?.name ?? "venture"}`,
                    body: `${pledge.digest.summary}\n\n${pledge.digest.insights}\n\n— JuaKali agent (demo email ritual)`,
                    createdAt: now + 31,
                });
            }

            // Third venture visible but not yet pledged by default investor
            await writeLedgerEvent(ctx, {
                type: "action",
                ventureId: ventureIds[2]!,
                summary: "Faith Tailoring Line listed for public investment — seeking first soft pledge for machine servicing.",
                createdAt: now + 50,
            });
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

async function processInvestorEmailNote(
    ctx: MutationCtx,
    args: {
        commitmentId: Id<"commitments">;
        body: string;
        subject?: string;
        metric?: string;
        value?: number;
        source?: "email_paste" | "agent" | "sms" | "manual";
        fromAddressOverride?: string;
        toAddressOverride?: string;
    }
) {
    const body = args.body.trim();
    if (body.length === 0) throw new Error("Email body is required");

    const commitment = await ctx.db.get(args.commitmentId);
    if (!commitment) throw new Error("Commitment not found");
    const venture = await ctx.db.get(commitment.ventureId);
    if (!venture) throw new Error("Venture not found");
    const investor = await ctx.db.get(commitment.investorId);
    if (!investor) throw new Error("Investor not found");

    const now = Date.now();
    const investorEmail = args.fromAddressOverride ?? investor.email ?? "investor@example.com";
    const agentAddress =
        args.toAddressOverride ?? venture.agentEmail ?? `${venture.publicSlug}@agent.juakali.demo`;
    const subject = args.subject?.trim() || `Re: ${venture.name}`;
    const source = args.source ?? "email_paste";

    const inboundId = await ctx.db.insert("agentEmails", {
        commitmentId: commitment._id,
        ventureId: venture._id,
        investorId: investor._id,
        direction: "inbound",
        fromAddress: investorEmail,
        toAddress: agentAddress,
        subject,
        body,
        createdAt: now,
    });

    const resolvedMetric =
        args.metric?.trim() ||
        (venture.kpiUnit === "meetings"
            ? "meetings_booked"
            : venture.kpiUnit === "jobs"
              ? "jobs_completed"
              : "revenue_kes");
    const value =
        args.value ??
        (venture.kpiUnit === "revenue_kes" ? 3500 : venture.kpiUnit === "jobs" ? 1 : 2);

    const checkInId = await ctx.db.insert("kpiCheckIns", {
        ventureId: venture._id,
        commitmentId: commitment._id,
        periodLabel: `Email · ${new Date(now).toISOString().slice(0, 10)}`,
        metric: resolvedMetric,
        value,
        note: body.slice(0, 160),
        source,
        createdAt: now + 1,
    });

    await writeLedgerEvent(ctx, {
        type: "checkin",
        ventureId: venture._id,
        commitmentId: commitment._id,
        summary: `${venture.name}: ${resolvedMetric} = ${value} (from investor email)`,
        metric: resolvedMetric,
        value,
        createdAt: now + 1,
    });

    const digestSummary = `Acted on your email for ${venture.name}: logged ${resolvedMetric}=${value}.`;
    const digestInsights =
        venture.peerMedian != null
            ? `Peer median this period is ~${venture.peerMedian}. Next digest ${commitment.digestCadence ?? "Weekly · Fri 08:00 EAT"}.`
            : `Next digest ${commitment.digestCadence ?? "Weekly · Fri 08:00 EAT"}.`;

    const digestId = await ctx.db.insert("agentDigests", {
        commitmentId: commitment._id,
        ventureId: venture._id,
        summary: digestSummary,
        insights: digestInsights,
        createdAt: now + 2,
    });

    await writeLedgerEvent(ctx, {
        type: "digest",
        ventureId: venture._id,
        commitmentId: commitment._id,
        summary: `Investor digest for ${venture.name}: ${digestSummary}`,
        createdAt: now + 2,
    });

    const replyBody = `${digestSummary}\n\n${digestInsights}\n\nEvidence tagged: email. Posted to the public ledger.\n\n— JuaKali agent`;

    const outboundId = await ctx.db.insert("agentEmails", {
        commitmentId: commitment._id,
        ventureId: venture._id,
        investorId: investor._id,
        direction: "outbound",
        fromAddress: agentAddress,
        toAddress: investorEmail,
        subject: `Re: ${subject.replace(/^Re:\s*/i, "")}`,
        body: replyBody,
        createdAt: now + 3,
    });

    await ctx.db.patch(commitment._id, {
        nextDigestAt: nextFridayEightEAT(now),
        digestCadence: commitment.digestCadence ?? "Weekly · Fri 08:00 EAT",
        updatedAt: now + 3,
    });

    return {
        inboundId,
        outboundId,
        checkInId,
        digestId,
        ventureName: venture.name,
        message: `Agent replied and logged ${resolvedMetric}=${value} for ${venture.name}.`,
        toolResults: [
            { tool: "log_kpi_checkin", detail: `${resolvedMetric}=${value}` },
            { tool: "create_investor_digest", detail: digestSummary },
            { tool: "post_public_ledger", detail: "checkin + digest events" },
            { tool: "send_reply", detail: `to ${investorEmail}` },
        ],
    };
}

function extractEmailAddress(raw: string): string {
    const angle = raw.match(/<([^>]+)>/);
    if (angle?.[1]) return angle[1].trim().toLowerCase();
    return raw.trim().toLowerCase();
}

export const sendInvestorEmail = mutation({
    args: {
        commitmentId: v.id("commitments"),
        body: v.string(),
        subject: v.optional(v.string()),
        metric: v.optional(v.string()),
        value: v.optional(v.number()),
    },
    returns: v.object({
        inboundId: v.id("agentEmails"),
        outboundId: v.id("agentEmails"),
        checkInId: v.union(v.id("kpiCheckIns"), v.null()),
        digestId: v.id("agentDigests"),
        ventureName: v.string(),
        message: v.string(),
        toolResults: v.array(v.object({ tool: v.string(), detail: v.string() })),
    }),
    handler: async (ctx, args) => {
        await rateLimiter.limit(ctx, "investMutate", { key: "emailRitual" });
        return await processInvestorEmailNote(ctx, {
            commitmentId: args.commitmentId,
            body: args.body,
            subject: args.subject,
            metric: args.metric,
            value: args.value,
            source: "email_paste",
        });
    },
});

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
        toolResults: v.array(v.object({ tool: v.string(), detail: v.string() })),
    }),
    handler: async (ctx, args) => {
        await rateLimiter.limit(ctx, "investMutate", { key: "agentmail" });
        const to = extractEmailAddress(args.toAddress);
        const from = extractEmailAddress(args.fromAddress);
        const body = (args.body || "").trim();
        if (!body) {
            return { ok: false, message: "Empty body", commitmentId: null, toolResults: [] };
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
        if (!venture) {
            return {
                ok: false,
                message: `No venture for inbox ${to}`,
                commitmentId: null,
                toolResults: [],
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
                    toolResults: [],
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
            return { ok: false, message: "Could not resolve commitment", commitmentId: null, toolResults: [] };
        }

        const result = await processInvestorEmailNote(ctx, {
            commitmentId: commitment._id,
            body,
            subject: args.subject,
            source: "email_paste",
            fromAddressOverride: from,
            toAddressOverride: to,
        });

        return {
            ok: true,
            message: result.message + (args.eventId ? ` (event ${args.eventId})` : ""),
            commitmentId: commitment._id,
            toolResults: result.toolResults,
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
