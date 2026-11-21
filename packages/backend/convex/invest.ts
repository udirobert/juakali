import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { rateLimiter } from "./rateLimit";
import { normalizeKey } from "./juaKaliHelpers";
import { currencyCodeValidator } from "./schemaCurrency";
import {
    assertCanAct,
    assertInvestorOwnsCommitment,
    assertInvestorOwnsInvestor,
    assertVentureOwner,
    ensureInvestorForUserId,
} from "./softAuth";
import {
    createAgentRun,
    createProposalForCommitment,
    planViewForRun,
    publicationViewForRun,
    publicationViewValidator,
} from "./agentRuns";
import {
    buildVentureSummary,
    kpiUnitValidator,
    sumVentureKpis,
    syncInvestorBriefing,
    syncInvestorsForVenture,
    syncVentureBrowse,
    ventureSummaryValidator,
} from "./investorBriefing";
import { formatPublicPledge, reportedRevenueKes } from "./publicCopy";
import {
    actionPlanViewValidator,
    synthesizeBriefingText,
    autonomyLevelValidator,
} from "./actionPlan";

type DbCtx = { db: QueryCtx["db"] };

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
    v.literal("wisdom"),
    v.literal("repayment")
);

function nextFridayEightEAT(fromMs: number = Date.now()) {
    const d = new Date(fromMs);
    const day = d.getUTCDay();
    // Approximate EAT (+3): target Friday 05:00 UTC = 08:00 EAT
    const daysUntilFri = (5 - day + 7) % 7 || 7;
    const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + daysUntilFri, 5, 0, 0));
    return next.getTime();
}

async function writeLedgerEvent(
    ctx: MutationCtx,
    args: {
        type: "pledge" | "checkin" | "digest" | "action" | "wisdom" | "repayment";
        ventureId?: Id<"ventures"> | null;
        commitmentId?: Id<"commitments"> | null;
        summary: string;
        amountKes?: number | null;
        metric?: string | null;
        value?: number | null;
        evidence?: string[];
        publicVisible?: boolean;
        txid?: string | null;
        onchainRef?: string | null;
        createdAt: number;
    }
) {
    // Denormalized venture metadata: the public ledger reads name/slug off the
    // event with zero lookups. Ventures have no rename path, so this never
    // goes stale. One venture read per write is negligible (writes are rare).
    let ventureName: string | null = null;
    let ventureSlug: string | null = null;
    if (args.ventureId) {
        const venture = await ctx.db.get(args.ventureId);
        ventureName = venture?.name ?? null;
        ventureSlug = venture?.publicSlug ?? null;
    }
    return await ctx.db.insert("ledgerEvents", {
        type: args.type,
        ventureId: args.ventureId ?? null,
        commitmentId: args.commitmentId ?? null,
        ventureName,
        ventureSlug,
        summary: args.summary,
        amountKes: args.amountKes ?? null,
        metric: args.metric ?? null,
        value: args.value ?? null,
        evidence: args.evidence,
        createdAt: args.createdAt,
        publicVisible: args.publicVisible ?? true,
        txid: args.txid ?? null,
        onchainRef: args.onchainRef ?? null,
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
    args: {
        displayName: string;
        email?: string | null;
        phone?: string | null;
        /** When the caller is signed in, bind the row so private surfaces resolve. */
        userId?: Id<"users"> | null;
    }
) {
    const displayName = args.displayName.trim() || "Investor";
    const email = args.email?.trim().toLowerCase() || null;
    const phone = args.phone?.trim() || null;
    const userId = args.userId ?? null;
    const now = Date.now();

    if (userId) {
        const byUser = await ctx.db
            .query("investors")
            .withIndex("by_userId", (q) => q.eq("userId", userId))
            .first();
        if (byUser) {
            await ctx.db.patch(byUser._id, {
                displayName: displayName || byUser.displayName,
                email: email ?? byUser.email ?? null,
                phone: phone ?? byUser.phone ?? null,
            });
            return byUser._id;
        }
    }

    if (email) {
        const existing = await ctx.db
            .query("investors")
            .withIndex("by_email", (q) => q.eq("email", email))
            .first();
        if (existing) {
            await ctx.db.patch(existing._id, {
                displayName: displayName || existing.displayName,
                phone: phone ?? existing.phone ?? null,
                ...(userId && !existing.userId ? { userId } : {}),
            });
            return existing._id;
        }
    }

    return await ctx.db.insert("investors", {
        displayName,
        email,
        phone,
        userId,
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

        // A new venture enters the global browse index.
        await syncVentureBrowse(ctx);

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
        /** ISO currency for this deal (default KES while Kenya is the only market). */
        currency: v.optional(currencyCodeValidator),
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
        if (!Number.isFinite(args.amountKes) || Math.round(args.amountKes) <= 0) throw new Error("Pledge must round to at least 1.");
        if (args.kpiTarget <= 0) throw new Error("kpiTarget must be positive");

        const userId = await getAuthUserId(ctx);
        const investorId = await upsertInvestorRecord(ctx, {
            displayName: args.investorName,
            email: args.investorEmail,
            userId,
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
        const currency = args.currency ?? "KES";
        const thesis =
            args.thesis?.trim() ||
            `Soft revenue-share pledge into ${name}: ${(shareBps / 100).toFixed(1)}% of cashflow until ${capMultiple}×.`;

        const commitmentId = await ctx.db.insert("commitments", {
            investorId,
            ventureId,
            amountKes: Math.round(args.amountKes),
            currency,
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
            summary: formatPublicPledge(investor?.displayName ?? "Investor", currency, args.amountKes, name, shareBps, capMultiple),
            amountKes: Math.round(args.amountKes),
            createdAt: now,
        });
        // A new commitment affects the briefing's next-scheduled digest, and
        // the new venture + pledge affect the global browse index.
        await syncInvestorBriefing(ctx, investorId);
        await syncVentureBrowse(ctx);

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
            bchAddress: v.union(v.string(), v.null()),
            nostrPubkey: v.union(v.string(), v.null()),
            identityProof: v.union(
                v.object({
                    bchSignature: v.string(),
                    address: v.optional(v.string()),
                    nostrEventId: v.string(),
                    boundAt: v.number(),
                }),
                v.null()
            ),
            settlementAsset: v.union(v.string(), v.null()),
            settlementNetwork: v.union(v.string(), v.null()),
            pledgeTxid: v.union(v.string(), v.null()),
            fundedAt: v.union(v.number(), v.null()),
            settlementAddress: v.union(v.string(), v.null()),
            repaidTotal: v.union(v.number(), v.null()),
            repayTxids: v.array(v.string()),
            fundedAmount: v.union(v.number(), v.null()),
            craftText: v.union(v.string(), v.null()),
            locationText: v.union(v.string(), v.null()),
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
                bchAddress: venture.bchAddress ?? null,
                nostrPubkey: venture.nostrPubkey ?? null,
                identityProof: venture.identityProof ?? null,
                settlementAsset: commitment.settlementAsset ?? null,
                settlementNetwork: commitment.settlementNetwork ?? null,
                pledgeTxid: commitment.pledgeTxid ?? null,
                fundedAt: commitment.fundedAt ?? null,
                settlementAddress: commitment.settlementAddress ?? null,
                repaidTotal: commitment.repaidTotal ?? null,
                repayTxids: commitment.repayTxids ?? [],
                fundedAmount: commitment.fundedAmount ?? null,
                craftText: venture.craftText ?? null,
                locationText: venture.locationText ?? null,
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
                bchAddress: venture.bchAddress ?? null,
                nostrPubkey: venture.nostrPubkey ?? null,
                identityProof: venture.identityProof ?? null,
                settlementAsset: commitment.settlementAsset ?? null,
                settlementNetwork: commitment.settlementNetwork ?? null,
                pledgeTxid: commitment.pledgeTxid ?? null,
                fundedAt: commitment.fundedAt ?? null,
                settlementAddress: commitment.settlementAddress ?? null,
                repaidTotal: commitment.repaidTotal ?? null,
                repayTxids: commitment.repayTxids ?? [],
                fundedAmount: commitment.fundedAmount ?? null,
                craftText: venture.craftText ?? null,
                locationText: venture.locationText ?? null,
            };
        }
        return null;
    },
});

/**
 * Record a venture's BCH↔Nostr identity binding. Both proofs are produced
 * client-side (the wallet signs the OP_RETURN commitment tx; the venture's
 * Nostr key signs the reverse-attestation event on public relays) — this row
 * only caches what is independently verifiable on-chain and on relays.
 */
export const bindVentureIdentity = mutation({
    args: {
        ventureId: v.id("ventures"),
        nostrPubkey: v.string(),
        bindingTxid: v.string(),
        nostrEventId: v.string(),
        boundAddress: v.string(),
    },
    returns: v.object({ ventureId: v.id("ventures"), message: v.string() }),
    handler: async (ctx, args) => {
        await rateLimiter.limit(ctx, "investMutate", { key: "identity" });
        const venture = await ctx.db.get(args.ventureId);
        if (!venture) throw new Error("Venture not found");
        const userId = await getAuthUserId(ctx);
        if (!userId) throw new Error("Authentication required");
        const ownerRows = await ctx.db
            .query("ventureOwners")
            .withIndex("by_ventureId", (q) => q.eq("ventureId", args.ventureId))
            .take(1);
        if (ownerRows.length > 0) {
            await assertVentureOwner(ctx, args.ventureId);
        }
        if (venture.identityProof && venture.nostrPubkey !== args.nostrPubkey) {
            throw new Error("Venture identity already bound — key rotation not supported yet");
        }
        await ctx.db.patch(args.ventureId, {
            nostrPubkey: args.nostrPubkey,
            identityProof: {
                // The binding txid carries the OP_RETURN commitment — it is the
                // BCH-side proof (stronger than a bare message signature:
                // timestamped on-chain and third-party readable).
                bchSignature: args.bindingTxid,
                address: args.boundAddress,
                nostrEventId: args.nostrEventId,
                boundAt: Date.now(),
            },
            updatedAt: Date.now(),
        });
        return {
            ventureId: args.ventureId,
            message: `Identity bound: ${venture.name} ↔ ${args.nostrPubkey.slice(0, 16)}…`,
        };
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
                txid: v.union(v.string(), v.null()),
                onchainRef: v.union(v.string(), v.null()),
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
            /** ISO currency of the totals (default KES). */
            currency: currencyCodeValidator,
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
            return { events: [], ventures: [], totals: { pledgedKes: 0, currency: "KES" as const, checkIns: 0, activeVentures: 0, digests: 0 } };
        }

        const rows = filterVenture
            ? await ctx.db
                  .query("ledgerEvents")
                  .withIndex("by_ventureId", (q) => q.eq("ventureId", filterVenture._id))
                  .order("desc")
                  .take(limit * 2)
            : await ctx.db.query("ledgerEvents").withIndex("by_createdAt").order("desc").take(limit * 2);
        // Legacy rows lack the denormalized metadata; resolve those lazily with
        // a per-handler cache so a legacy feed never degrades into N+1 reads.
        const ventureMeta = new Map<string, { name: string; slug: string } | null>();
        async function metaFor(ventureId: Id<"ventures"> | null | undefined) {
            if (!ventureId) return null;
            const key = String(ventureId);
            let meta = ventureMeta.get(key);
            if (meta === undefined) {
                const venture = await ctx.db.get(ventureId);
                meta = venture ? { name: venture.name, slug: venture.publicSlug } : null;
                ventureMeta.set(key, meta);
            }
            return meta;
        }
        const events = [];
        for (const row of rows) {
            if (!row.publicVisible) continue;
            const meta = await metaFor(row.ventureId);
            events.push({
                id: row._id,
                type: row.type,
                summary: row.summary,
                amountKes: row.amountKes ?? null,
                metric: row.metric ?? null,
                value: row.value ?? null,
                evidence: row.evidence ?? [],
                ventureName: row.ventureName ?? meta?.name ?? null,
                ventureSlug: row.ventureSlug ?? meta?.slug ?? null,
                createdAt: row.createdAt,
                correlationId: row.correlationId ?? null,
                runId: row.runId ?? null,
                initiator: row.initiator ?? null,
                publicVisible: row.publicVisible,
                txid: row.txid ?? null,
                onchainRef: row.onchainRef ?? null,
            });
            if (events.length >= limit) break;
        }

        // Ventures that appear on the public ledger (filter chips) — one scan;
        // names/slugs come from the denormalized event fields (cached fallback
        // for legacy rows), so no per-venture lookups are needed.
        const recentEvents = await ctx.db
            .query("ledgerEvents")
            .withIndex("by_createdAt")
            .order("desc")
            .take(400);
        const ventures = [];
        const seenVentures = new Set<string>();
        for (const event of recentEvents) {
            if (!event.publicVisible || !event.ventureId || seenVentures.has(String(event.ventureId))) continue;
            seenVentures.add(String(event.ventureId));
            const meta = await metaFor(event.ventureId);
            const name = event.ventureName ?? meta?.name ?? null;
            const slug = event.ventureSlug ?? meta?.slug ?? null;
            if (!name || !slug) continue;
            ventures.push({ id: event.ventureId, name, slug });
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
                currency: filterVenture?.currency ?? "KES",
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
        // The global ventureBrowse index serves the landing browse too — one
        // doc instead of re-scanning every venture + KPI + pledge per render.
        const browse = await ctx.db.query("ventureBrowse").first();
        if (browse) return { ventures: browse.ventures };
        const ventures = await ctx.db.query("ventures").order("desc").take(50);
        const results = [];
        for (const venture of ventures) {
            const summary = await buildVentureSummary(ctx, venture._id);
            if (summary) results.push(summary);
        }
        return { ventures: results };
    },
});

/**
 * Public aggregate impact — the page a development-finance partner would
 * forward. Unauthenticated by design (public-by-default). Jobs = cumulative
 * jobs KPI across ventures; revenue = cumulative revenue_kes KPI; deployed =
 * soft pledges (labeled intent, not settlement).
 */
export const impactTotals = query({
    args: {},
    returns: v.object({
        venturesCount: v.number(),
        activeVentures: v.number(),
        pledgedKes: v.number(),
        investorsCount: v.number(),
        jobsCreated: v.number(),
        revenueKes: v.number(),
        checkIns: v.number(),
        digests: v.number(),
    }),
    handler: async (ctx) => {
        const ventures = await ctx.db.query("ventures").take(500);
        const commitments = await ctx.db.query("commitments").take(500);
        const checkIns = await ctx.db.query("kpiCheckIns").take(1000);
        const digests = await ctx.db.query("agentDigests").take(1000);
        const investorIds = new Set(commitments.map((row) => String(row.investorId)));

        let jobsCreated = 0;
        let revenueKes = 0;
        for (const row of checkIns) {
            if (row.metric === "jobs") jobsCreated += row.value;
            else if (row.metric === "revenue_kes") revenueKes += row.value;
        }

        return {
            venturesCount: ventures.length,
            activeVentures: ventures.filter((row) => row.status === "active").length,
            pledgedKes: commitments.reduce((sum, row) => sum + row.amountKes, 0),
            investorsCount: investorIds.size,
            jobsCreated,
            revenueKes,
            checkIns: checkIns.length,
            digests: digests.length,
        };
    },
});

/**
 * Investor portfolio — the one screen for the busy investor with several
 * deals: total deployed, per-deal staleness (KPI age), pending decisions,
 * and cap progress. Authenticated owner only (fail-closed like the cockpit).
 */
export const portfolio = query({
    args: {},
    returns: v.union(
        v.null(),
        v.object({
            totalPledgedKes: v.number(),
            dealCount: v.number(),
            pendingDecisions: v.number(),
            pendingPublication: v.number(),
            staleDeals: v.array(
                v.object({
                    commitmentId: v.id("commitments"),
                    ventureName: v.string(),
                    hoursSinceCheckIn: v.union(v.number(), v.null()),
                })
            ),
            deals: v.array(
                v.object({
                    commitmentId: v.id("commitments"),
                    ventureName: v.string(),
                    ventureSlug: v.string(),
                    amountKes: v.number(),
                    status: commitmentStatusValidator,
                    hoursSinceCheckIn: v.union(v.number(), v.null()),
                    hasOpenProposal: v.boolean(),
                })
            ),
        })
    ),
    handler: async (ctx) => {
        const userId = await getAuthUserId(ctx);
        const linkedInvestor = userId
            ? await ctx.db
                  .query("investors")
                  .withIndex("by_userId", (q) => q.eq("userId", userId))
                  .first()
            : null;
        if (!linkedInvestor) return null;

        const rows = await ctx.db
            .query("commitments")
            .withIndex("by_investorId", (q) => q.eq("investorId", linkedInvestor._id))
            .order("desc")
            .take(50);

        const now = Date.now();
        const STALE_MS = 24 * 60 * 60 * 1000;
        const deals: Array<{
            commitmentId: Id<"commitments">;
            ventureName: string;
            ventureSlug: string;
            amountKes: number;
            status: Doc<"commitments">["status"];
            hoursSinceCheckIn: number | null;
            hasOpenProposal: boolean;
        }> = [];
        let pendingDecisions = 0;
        let pendingPublication = 0;

        for (const row of rows) {
            const venture = await ctx.db.get(row.ventureId);
            if (!venture) continue;

            const latestCheckIn = await ctx.db
                .query("kpiCheckIns")
                .withIndex("by_ventureId", (q) => q.eq("ventureId", row.ventureId))
                .order("desc")
                .take(1);
            const hoursSinceCheckIn = latestCheckIn[0]
                ? Math.floor((now - latestCheckIn[0]!.createdAt) / 3_600_000)
                : null;

            const runs = await ctx.db
                .query("agentRuns")
                .withIndex("by_commitmentId", (q) => q.eq("commitmentId", row._id))
                .order("desc")
                .take(20);
            const hasOpenProposal = runs.some((run) => run.status === "proposed");
            pendingDecisions += runs.filter((run) => run.status === "proposed").length;
            pendingPublication += runs.filter((run) => run.status === "awaiting_publication").length;

            deals.push({
                commitmentId: row._id,
                ventureName: venture.name,
                ventureSlug: venture.publicSlug,
                amountKes: row.amountKes,
                status: row.status,
                hoursSinceCheckIn,
                hasOpenProposal,
            });
        }

        const staleDeals = deals
            .filter((deal) => (deal.hoursSinceCheckIn ?? Infinity) * 3_600_000 > STALE_MS)
            .map((deal) => ({
                commitmentId: deal.commitmentId,
                ventureName: deal.ventureName,
                hoursSinceCheckIn: deal.hoursSinceCheckIn,
            }));

        return {
            totalPledgedKes: rows.reduce((sum, row) => sum + row.amountKes, 0),
            dealCount: deals.length,
            pendingDecisions,
            pendingPublication,
            staleDeals,
            deals,
        };
    },
});

/**
 * Assemble one cockpit commitment row from a commitment doc + its projection
 * (either from the briefing index or from the scan fallback). Keeps the two
 * paths producing the identical shape.
 */
function commitmentFromProjection(
    row: Doc<"commitments">,
    proj: NonNullable<Doc<"investorBriefings">["cockpit"]>[number]
) {
    /**
     * Revenue-share estimate: the pledge cap is the rounded pledge ×
     * capMultiple. The estimated share is derived only from self-reported
     * `revenue_kes` check-ins recorded after the pledge — jobs and meetings
     * are never counted as money. KES commitments only; anything else (or a
     * bounded/unclean read) reports null rather than a fabricated number.
     */
    const capKes = Math.round(row.amountKes) * row.capMultiple;
    const reported =
        (row.currency ?? "KES") === "KES" ? (proj.reportedRevenueKes ?? null) : null;
    const estimatedShareKes =
        reported == null ? null : Math.min(capKes, (reported * row.shareBps) / 10_000);
    const capProgress = {
        capKes,
        reportedRevenueKes: reported,
        estimatedShareKes,
    };
    return {
        id: row._id,
        amountKes: row.amountKes,
        currency: row.currency ?? "KES",
        shareBps: row.shareBps,
        capMultiple: row.capMultiple,
        status: row.status,
        thesis: row.thesis,
        nextDigestAt: row.nextDigestAt ?? null,
        digestCadence: row.digestCadence ?? null,
        createdAt: row.createdAt,
        settlementAsset: row.settlementAsset ?? null,
        settlementNetwork: row.settlementNetwork ?? null,
        settlementAddress: row.settlementAddress ?? null,
        pledgeTxid: row.pledgeTxid ?? null,
        fundedAt: row.fundedAt ?? null,
        repaidTotal: row.repaidTotal ?? null,
        venture: proj.venture,
        latestDigest: proj.latestDigest,
        recentCheckIns: proj.recentCheckIns,
        recentEmails: proj.recentEmails,
        openProposal: proj.openProposal,
        capProgress,
    };
}

/**
 * Legacy scan path for investors without a briefing index yet (pre-backfill).
 * Kept so the cockpit stays correct until syncInvestorBriefing has run for
 * every investor; the indexed path above is the common case.
 */
async function buildCockpitFromScan(
    ctx: DbCtx,
    investorId: Id<"investors">,
    commitmentRows: Doc<"commitments">[]
): Promise<{
    commitments: ReturnType<typeof commitmentFromProjection>[];
    agentPresence: { lastWorkedAt: number | null; runsThisWeek: number; openProposals: number };
}> {
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    let lastWorkedAt: number | null = null;
    let runsThisWeek = 0;
    let openProposals = 0;
    const commitments: ReturnType<typeof commitmentFromProjection>[] = [];

    for (const row of commitmentRows) {
        const venture = await buildVentureSummary(ctx, row.ventureId);
        if (!venture) continue;
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
                if (
                    run.status !== "proposed" &&
                    (lastWorkedAt === null || run.updatedAt > lastWorkedAt)
                ) {
                    lastWorkedAt = run.updatedAt;
                }
                if (run.createdAt >= weekAgo && run.status !== "proposed") runsThisWeek += 1;
            }
        }
        commitments.push(
            commitmentFromProjection(row, {
                commitmentId: row._id,
                venture,
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
                reportedRevenueKes: reportedRevenueKes(checkIns, row.createdAt),
            })
        );
    }
    return { commitments, agentPresence: { lastWorkedAt, runsThisWeek, openProposals } };
}

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
                currency: currencyCodeValidator,
                shareBps: v.number(),
                capMultiple: v.number(),
                status: commitmentStatusValidator,
                thesis: v.string(),
                nextDigestAt: v.union(v.number(), v.null()),
                digestCadence: v.union(v.string(), v.null()),
                createdAt: v.number(),
                settlementAsset: v.union(v.string(), v.null()),
                settlementNetwork: v.union(v.string(), v.null()),
                settlementAddress: v.union(v.string(), v.null()),
                pledgeTxid: v.union(v.string(), v.null()),
                fundedAt: v.union(v.number(), v.null()),
                repaidTotal: v.union(v.number(), v.null()),
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
                /**
                 * Revenue-share estimate vs cap (intent model, not settlement).
                 * reportedRevenueKes / estimatedShareKes are null when there is
                 * no usable revenue data — never derived from other metrics.
                 */
                capProgress: v.object({
                    capKes: v.number(),
                    reportedRevenueKes: v.union(v.number(), v.null()),
                    estimatedShareKes: v.union(v.number(), v.null()),
                }),
            })
        ),
        availableVentures: v.array(ventureSummaryValidator),
        /** Agent presence — Jua is visibly alive between visits. */
        agentPresence: v.object({
            lastWorkedAt: v.union(v.number(), v.null()),
            runsThisWeek: v.number(),
            openProposals: v.number(),
        }),
        /** A run parked in awaiting_publication — the pipeline's second gate.
         *  Nothing publishes until the investor approves the exact KPI +
         *  public summary; the cockpit must surface it or the loop stalls
         *  invisibly on the Deals surface (Today already does). */
        pendingPublication: v.union(
            v.object({
                id: v.id("agentRuns"),
                commitmentId: v.id("commitments"),
                kpiMetric: v.union(v.string(), v.null()),
                kpiValue: v.union(v.number(), v.null()),
                approvedSummary: v.union(v.string(), v.null()),
                createdAt: v.number(),
            }),
            v.null()
        ),
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

        // Primary path: the denormalized briefing index carries the full
        // per-commitment cockpit projection (venture summary, latest digest,
        // recent check-ins/emails, open proposal) plus presence. Only the
        // commitment's own fields are read from the commitment rows.
        const briefing = investorId
            ? await ctx.db
                  .query("investorBriefings")
                  .withIndex("by_investorId", (q) => q.eq("investorId", investorId!))
                  .first()
            : null;

        let commitments: ReturnType<typeof commitmentFromProjection>[] = [];
        let agentPresence: {
            lastWorkedAt: number | null;
            runsThisWeek: number;
            openProposals: number;
        } = { lastWorkedAt: null, runsThisWeek: 0, openProposals: 0 };

        if (briefing?.cockpit && briefing.presence) {
            const cockpitByCommitment = new Map(
                briefing.cockpit.map((row) => [String(row.commitmentId), row] as const)
            );
            commitments = [];
            for (const row of commitmentRows) {
                const proj = cockpitByCommitment.get(String(row._id));
                if (!proj) continue;
                commitments.push(commitmentFromProjection(row, proj));
            }
            agentPresence = briefing.presence;
        } else if (investorId) {
            const built = await buildCockpitFromScan(ctx, investorId, commitmentRows);
            commitments = built.commitments;
            agentPresence = built.agentPresence;
        }

        // The second approval gate: a run parked in awaiting_publication pauses
        // the pipeline until the investor approves the exact KPI + public
        // summary. Only the focus commitment needs it — the cockpit renders one
        // selected deal at a time, so one indexed query suffices.
        let pendingPublication: {
            id: Id<"agentRuns">;
            commitmentId: Id<"commitments">;
            kpiMetric: string | null;
            kpiValue: number | null;
            approvedSummary: string | null;
            createdAt: number;
        } | null = null;
        if (focusCommitmentId) {
            const runs = await ctx.db
                .query("agentRuns")
                .withIndex("by_commitmentId", (q) => q.eq("commitmentId", focusCommitmentId))
                .order("desc")
                .take(20);
            const stalled = runs.find((run) => run.status === "awaiting_publication");
            if (stalled) {
                pendingPublication = {
                    id: stalled._id,
                    commitmentId: stalled.commitmentId,
                    kpiMetric: stalled.pipeline?.kpiMetric ?? null,
                    kpiValue:
                        stalled.pipeline?.kpiValue ??
                        (stalled.pipeline?.kpiBefore != null || stalled.pipeline?.kpiAfter != null
                            ? stalled.pipeline?.kpiAfter ?? null
                            : null),
                    approvedSummary: stalled.approvedSummary ?? null,
                    createdAt: stalled.createdAt,
                };
            }
        }

        // Browse list: the global ventureBrowse index (one doc, same for every
        // investor) carries the summaries — the cockpit filters to active
        // ventures. Fall back to the scan only for pre-backfill deployments.
        const browse = await ctx.db.query("ventureBrowse").first();
        let availableVentures: Doc<"ventureBrowse">["ventures"] = [];
        if (browse) {
            availableVentures = browse.ventures.filter((venture) => venture.status === "active");
        } else {
            const allVentures = await ctx.db.query("ventures").order("desc").take(30);
            for (const venture of allVentures) {
                if (venture.status !== "active") continue;
                const summary = await buildVentureSummary(ctx, venture._id);
                if (summary) availableVentures.push(summary);
            }
        }

        return {
            investor,
            focusCommitmentId: focusCommitmentId ?? commitments[0]?.id ?? null,
            commitments,
            availableVentures,
            agentPresence,
            pendingPublication,
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
        publication: null,
        completed: [],
        digests: [],
        nextScheduled: null,
        stats: { needsDecision: 0, venturesMoved: 0, blocked: 0 },
        autonomyLevel: "ask_every_time" as const,
    };
}

const todayDigestValidator = v.object({
    id: v.id("agentDigests"),
    commitmentId: v.id("commitments"),
    ventureName: v.string(),
    summary: v.string(),
    insights: v.string(),
    nextAction: v.union(v.string(), v.null()),
    evidence: v.array(v.string()),
    createdAt: v.number(),
});

/** Pull the newest digests off the cockpit projection for Today's bento. */
function digestsFromCockpit(
    cockpit: NonNullable<Doc<"investorBriefings">["cockpit"]> | undefined
) {
    if (!cockpit) return [];
    return cockpit
        .filter((row) => row.latestDigest != null)
        .map((row) => ({
            id: row.latestDigest!.id,
            commitmentId: row.commitmentId,
            ventureName: row.venture.name,
            summary: row.latestDigest!.summary,
            insights: row.latestDigest!.insights,
            nextAction: row.latestDigest!.nextAction,
            evidence: row.latestDigest!.evidence,
            createdAt: row.latestDigest!.createdAt,
        }))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 3);
}

/**
 * Build the Today briefing from the denormalized investorBriefings index.
 * O(1)-ish reads: the index doc, plus the top decision/publication run and its
 * venture when a card is due. No per-commitment run scans or ledger lookups.
 */
async function buildTodayBriefingFromIndex(
    ctx: DbCtx,
    investor: Doc<"investors"> | null,
    briefing: Doc<"investorBriefings">
) {
    const greetingName = investor?.displayName?.split(/\s+/)[0] ?? null;
    const autonomyLevel = investor?.autonomyLevel ?? "ask_every_time";

    const decisions = briefing.decisions;
    const top = decisions[0];
    const topAwaiting = decisions.find((d) => d.status === "awaiting_publication");

    // The proposal card only applies to proposed runs; a run awaiting
    // publication renders the second-step card instead. Guards re-check the
    // live run status defensively in case the index is momentarily stale.
    let decision: ReturnType<typeof planViewForRun> = null;
    if (top && top.status === "proposed") {
        const run = await ctx.db.get(top.id);
        if (run && run.status === "proposed") {
            const venture = await ctx.db.get(run.ventureId);
            decision = planViewForRun(run, venture?.name ?? top.ventureName);
        }
    }
    let publication: ReturnType<typeof publicationViewForRun> = null;
    if (topAwaiting) {
        const run = await ctx.db.get(topAwaiting.id);
        if (run && run.status === "awaiting_publication") {
            const venture = await ctx.db.get(run.ventureId);
            publication = publicationViewForRun(run, venture?.name ?? topAwaiting.ventureName);
        }
    }

    const needsDecision = decisions.length;
    const venturesMoved = briefing.movedVentureIds.length;
    const blocked = briefing.blockedCount;

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
        publication,
        completed: briefing.completed.slice(0, 8).map((item) => ({
            title: item.title ?? item.subject,
            proofEventId: item.proofEventId ?? null,
            commitmentId: item.commitmentId,
            runId: item.id,
            at: item.updatedAt,
        })),
        digests: digestsFromCockpit(briefing.cockpit),
        nextScheduled: briefing.nextScheduled,
        stats: { needsDecision, venturesMoved, blocked },
        autonomyLevel,
    };
}

/**
 * Legacy scan path for investors without a briefing index yet (pre-backfill).
 * Kept so Today stays correct until syncInvestorBriefing has run for every
 * investor; the indexed path above is the common case.
 */
async function buildTodayBriefingFromScan(
    ctx: DbCtx,
    investorId: Id<"investors">,
    investor: Doc<"investors"> | null
) {
    const greetingName = investor?.displayName?.split(/\s+/)[0] ?? null;
    const autonomyLevel = investor?.autonomyLevel ?? "ask_every_time";

    const commitments = await ctx.db
        .query("commitments")
        .withIndex("by_investorId", (q) => q.eq("investorId", investorId!))
        .order("desc")
        .take(30);

    const proposals: Array<{ run: Doc<"agentRuns">; ventureName: string }> = [];
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
                proposals.push({ run, ventureName });
            } else if (run.status === "awaiting_publication") {
                proposals.push({ run, ventureName });
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
    const topAwaiting = proposals.find((p) => p.run.status === "awaiting_publication");
    // The proposal card only applies to proposed runs; a run awaiting
    // publication renders the second-step card instead.
    const decision =
        top && top.run.status === "proposed" ? planFromRun(top.run, top.ventureName) : null;
    // Second-step approval surfaces the exact KPI + verbatim summary.
    const publication =
        topAwaiting && topAwaiting.run.status === "awaiting_publication"
            ? publicationViewForRun(topAwaiting.run, topAwaiting.ventureName)
            : null;
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
        publication,
        completed: completed.slice(0, 8),
        digests: await digestsFromCommitmentsScan(ctx, commitments),
        nextScheduled,
        stats: { needsDecision, venturesMoved, blocked },
        autonomyLevel,
    };
}

/** Scan-path digest gather — only used when the briefing index is missing. */
async function digestsFromCommitmentsScan(
    ctx: DbCtx,
    commitments: Doc<"commitments">[]
) {
    const digests: Array<{
        id: Id<"agentDigests">;
        commitmentId: Id<"commitments">;
        ventureName: string;
        summary: string;
        insights: string;
        nextAction: string | null;
        evidence: string[];
        createdAt: number;
    }> = [];
    for (const commitment of commitments.slice(0, 8)) {
        const latest = await ctx.db
            .query("agentDigests")
            .withIndex("by_commitmentId", (q) => q.eq("commitmentId", commitment._id))
            .order("desc")
            .first();
        if (!latest) continue;
        const venture = await ctx.db.get(commitment.ventureId);
        digests.push({
            id: latest._id,
            commitmentId: commitment._id,
            ventureName: venture?.name ?? "Venture",
            summary: latest.summary,
            insights: latest.insights,
            nextAction: latest.nextAction ?? null,
            evidence: latest.evidence ?? [],
            createdAt: latest.createdAt,
        });
    }
    return digests.sort((a, b) => b.createdAt - a.createdAt).slice(0, 3);
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
        /** Newest digests for the bento on a filled desk (up to 3). */
        digests: v.array(todayDigestValidator),
        nextScheduled: v.union(
            v.object({
                label: v.string(),
                at: v.number(),
            }),
            v.null()
        ),
        /** Second-step approval: evidence arrived, exact KPI + summary to publish. */
        publication: v.union(publicationViewValidator, v.null()),
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

        // Primary path: the denormalized briefing index. Fall back to the scan
        // only for investors whose index hasn't been built yet (pre-backfill).
        const briefing = await ctx.db
            .query("investorBriefings")
            .withIndex("by_investorId", (q) => q.eq("investorId", investorId!))
            .first();
        if (!briefing) return await buildTodayBriefingFromScan(ctx, investorId, investor);
        return await buildTodayBriefingFromIndex(ctx, investor, briefing);
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
            txid: v.union(v.string(), v.null()),
            onchainRef: v.union(v.string(), v.null()),
            chain: v.array(
                v.object({
                    id: v.id("ledgerEvents"),
                    type: ledgerTypeValidator,
                    summary: v.string(),
                    createdAt: v.number(),
                    initiator: v.union(v.string(), v.null()),
                    evidence: v.array(v.string()),
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
            txid: event.txid ?? null,
            onchainRef: event.onchainRef ?? null,
            chain: visibleChain.map((row) => ({
                id: row._id,
                type: row.type,
                summary: row.summary,
                createdAt: row.createdAt,
                initiator: row.initiator ?? null,
                evidence: row.evidence ?? [],
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
        /** ISO currency for this deal (default KES while Kenya is the only market). */
        currency: v.optional(currencyCodeValidator),
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
        if (!Number.isFinite(args.amountKes) || Math.round(args.amountKes) <= 0) throw new Error("Pledge must round to at least 1.");

        const venture = await ctx.db.get(args.ventureId);
        if (!venture) throw new Error("Venture not found");

        // Prefer the signed-in caller's desk — never silently attach a pledge
        // to the shared Wanjiru demo investor (that made invitees "succeed"
        // into an empty private surface while Proof showed someone else's work).
        const userId = await getAuthUserId(ctx);
        let investorId = args.investorId ?? null;
        if (userId) {
            const linked = await ensureInvestorForUserId(
                ctx,
                userId,
                args.investorName?.trim() || undefined
            );
            investorId = linked.investorId;
        } else if (!investorId && (args.investorName?.trim() || args.investorEmail?.trim())) {
            investorId = await upsertInvestorRecord(ctx, {
                displayName: args.investorName?.trim() || "Investor",
                email: args.investorEmail,
            });
        }
        if (!investorId) {
            throw new Error("Sign in to record a pledge on your desk.");
        }

        const investor = await ctx.db.get(investorId);
        if (!investor) throw new Error("Investor not found");

        const now = Date.now();
        const shareBps = args.shareBps ?? 1000;
        const capMultiple = args.capMultiple ?? 2;
        const currency = args.currency ?? "KES";
        const thesis =
            args.thesis?.trim() ||
            `Soft revenue-share pledge into ${venture.name}: ${(shareBps / 100).toFixed(1)}% of cashflow until ${capMultiple}×.`;

        const commitmentId = await ctx.db.insert("commitments", {
            investorId,
            ventureId: args.ventureId,
            amountKes: Math.round(args.amountKes),
            currency,
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
            summary: formatPublicPledge(investor.displayName, currency, args.amountKes, venture.name, shareBps, capMultiple),
            amountKes: Math.round(args.amountKes),
            createdAt: now,
        });
        // A new commitment affects the briefing's next-scheduled digest, and
        // the pledge changes the venture's pledged total in the browse index.
        await syncInvestorBriefing(ctx, investorId);
        await syncVentureBrowse(ctx);

        return {
            commitmentId,
            investorId,
            message: `Pledged KES ${Math.round(args.amountKes).toLocaleString()} into ${venture.name}.`,
        };
    },
});

// ---------------------------------------------------------------------------
// BCH settlement (BCH Blaze 2026). The chain is the source of truth for value
// transfer — these mutations only cache txids/addresses that the client already
// broadcast and anyone can verify on an explorer. Private data never leaves
// Convex; on-chain rows only reference txids.
// ---------------------------------------------------------------------------

const bchNetworkValidator = v.union(v.literal("chipnet"), v.literal("mainnet"));
const settlementAssetValidator = v.union(v.literal("bch"), v.literal("pusd"));

/** Set (or update) a venture's on-chain receiving identity. */
export const setVentureSettlement = mutation({
    args: {
        ventureId: v.id("ventures"),
        bchAddress: v.string(),
        nostrPubkey: v.optional(v.union(v.string(), v.null())),
        bindingProof: v.optional(v.union(v.string(), v.null())),
    },
    returns: v.object({ ventureId: v.id("ventures"), message: v.string() }),
    handler: async (ctx, args) => {
        await rateLimiter.limit(ctx, "investMutate", { key: "settlement" });
        const venture = await ctx.db.get(args.ventureId);
        if (!venture) throw new Error("Venture not found");

        // Real deployments: the venture owner links their wallet. Demo seeds
        // have no ventureOwners row — let the first authenticated caller bind
        // once so the hackathon demo can wire settlement without a founder
        // round-trip. Once a binding exists, only the owner may rotate it.
        const ownerRows = await ctx.db
            .query("ventureOwners")
            .withIndex("by_ventureId", (q) => q.eq("ventureId", args.ventureId))
            .take(1);
        const userId = await getAuthUserId(ctx);
        if (ownerRows.length > 0) {
            await assertVentureOwner(ctx, args.ventureId);
        } else if (venture.bchAddress) {
            if (!userId) throw new Error("Authentication required");
            const owner = await ctx.db
                .query("ventureOwners")
                .withIndex("by_userId", (q) => q.eq("userId", userId))
                .first();
            if (!owner || owner.ventureId !== args.ventureId) {
                throw new Error("Venture settlement address already bound");
            }
        } else if (!userId) {
            await assertCanAct(ctx);
        }

        const addr = args.bchAddress.trim();
        if (!/^(bitcoincash|bchtest):[a-z0-9]{42,}$/.test(addr)) {
            throw new Error("bchAddress must be a cashaddr (bitcoincash:… or bchtest:…)");
        }
        await ctx.db.patch(args.ventureId, {
            bchAddress: addr,
            ...(args.nostrPubkey !== undefined ? { nostrPubkey: args.nostrPubkey } : {}),
            ...(args.bindingProof !== undefined ? { bindingProof: args.bindingProof } : {}),
            updatedAt: Date.now(),
        });
        return { ventureId: args.ventureId, message: `Settlement address set for ${venture.name}.` };
    },
});

/**
 * Cache an on-chain funding txid on a commitment. Call after the wallet signs
 * and the dapp broadcasts — settlement status derives from the chain; this row
 * is the product-layer index of that fact.
 */
export const recordPledgeFunding = mutation({
    args: {
        commitmentId: v.id("commitments"),
        txid: v.string(),
        asset: settlementAssetValidator,
        network: bchNetworkValidator,
        settlementAddress: v.string(),
        /** Satoshis (bch) or token base units (pusd) sent. */
        amount: v.number(),
        onchainRef: v.optional(v.string()),
    },
    returns: v.object({ commitmentId: v.id("commitments"), message: v.string() }),
    handler: async (ctx, args) => {
        await assertCanAct(ctx);
        await rateLimiter.limit(ctx, "investMutate", { key: "settlement" });
        const investorId = await assertInvestorOwnsCommitment(ctx, args.commitmentId);
        const commitment = await ctx.db.get(args.commitmentId);
        if (!commitment) throw new Error("Commitment not found");
        if (!/^[0-9a-f]{64}$/i.test(args.txid)) throw new Error("txid must be a 64-hex digest");
        if (args.amount <= 0) throw new Error("amount must be positive");
        // Idempotent: a retried index of the same broadcast is a no-op, and a
        // different txid on an already-funded commitment is a conflict, not a
        // silent overwrite of the on-chain record.
        if (commitment.pledgeTxid) {
            if (commitment.pledgeTxid === args.txid) {
                return { commitmentId: args.commitmentId, message: "Funding already recorded." };
            }
            throw new Error("Commitment already has a funding tx on record");
        }

        const venture = await ctx.db.get(commitment.ventureId);
        const investor = await ctx.db.get(investorId);
        const now = Date.now();
        await ctx.db.patch(args.commitmentId, {
            settlementAsset: args.asset,
            settlementNetwork: args.network,
            settlementAddress: args.settlementAddress,
            pledgeTxid: args.txid,
            fundedAt: now,
            fundedAmount: args.amount,
            status: commitment.status === "pledged" ? "active" : commitment.status,
            updatedAt: now,
        });
        await writeLedgerEvent(ctx, {
            type: "pledge",
            ventureId: commitment.ventureId,
            commitmentId: args.commitmentId,
            summary: `${investor?.displayName ?? "Investor"} funded ${venture?.name ?? "the venture"} on-chain — ${args.amount} ${args.asset === "bch" ? "sats" : "PUSD units"} (${args.network})`,
            evidence: ["onchain", "wizardconnect"],
            txid: args.txid,
            onchainRef: args.onchainRef ?? null,
            createdAt: now,
        });
        await syncInvestorBriefing(ctx, investorId);
        return { commitmentId: args.commitmentId, message: "Funding recorded." };
    },
});

/** Cache an on-chain repayment txid against a commitment. */
export const recordRepayment = mutation({
    args: {
        commitmentId: v.id("commitments"),
        txid: v.string(),
        network: bchNetworkValidator,
        /** Satoshis (bch) or token base units (pusd) repaid in this tx. */
        amount: v.number(),
        onchainRef: v.optional(v.string()),
    },
    returns: v.object({ commitmentId: v.id("commitments"), message: v.string() }),
    handler: async (ctx, args) => {
        await assertCanAct(ctx);
        await rateLimiter.limit(ctx, "investMutate", { key: "settlement" });
        const investorId = await assertInvestorOwnsCommitment(ctx, args.commitmentId);
        const commitment = await ctx.db.get(args.commitmentId);
        if (!commitment) throw new Error("Commitment not found");
        if (!/^[0-9a-f]{64}$/i.test(args.txid)) throw new Error("txid must be a 64-hex digest");
        if (args.amount <= 0) throw new Error("amount must be positive");

        const venture = await ctx.db.get(commitment.ventureId);
        const now = Date.now();
        const repaidTotal = (commitment.repaidTotal ?? 0) + args.amount;
        const repayTxids = [...(commitment.repayTxids ?? []), args.txid];
        await ctx.db.patch(args.commitmentId, {
            repaidTotal,
            repayTxids,
            updatedAt: now,
        });
        await writeLedgerEvent(ctx, {
            type: "repayment",
            ventureId: commitment.ventureId,
            commitmentId: args.commitmentId,
            summary: `${venture?.name ?? "Venture"} repaid ${args.amount} ${commitment.settlementAsset === "pusd" ? "PUSD units" : "sats"} on-chain (${args.network})`,
            evidence: ["onchain"],
            txid: args.txid,
            onchainRef: args.onchainRef ?? null,
            createdAt: now,
        });
        await syncInvestorBriefing(ctx, investorId);
        return { commitmentId: args.commitmentId, message: "Repayment recorded." };
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
        // The cockpit projection's check-ins + venture summary must refresh,
        // and the KPI changes the browse index's kpiLatest/kpiTotal.
        await syncInvestorsForVenture(ctx, ventureId);
        await syncVentureBrowse(ctx);

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
        // The cockpit projection's latest digest must refresh.
        await syncInvestorBriefing(ctx, commitment.investorId);

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
        /** First commitment on the caller's desk — null when they still need to sign in. */
        commitmentId: v.union(v.id("commitments"), v.null()),
        /** True when the caller is anonymous: platform data may exist, but their desk is empty. */
        needsAuth: v.boolean(),
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
        let platformInvestorId = existingDefault?._id ?? null;
        if (!platformInvestorId) {
            platformInvestorId = await ctx.db.insert("investors", {
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

        const demoPledges = [
            {
                ventureId: ventureIds[0]!,
                amountKes: 15000,
                shareBps: 1000,
                thesis: "Back Amina’s outbound week — pay for airtime + CRM coaching; share 10% of sales cashflow until 2×.",
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

        let createdCommitments = 0;
        let createdCheckIns = 0;
        let createdDigests = 0;

        // Platform demo investor (Wanjiru) — keeps the public ledger alive for
        // cold visitors. Private surfaces never resolve to this row anonymously.
        const existingPlatformCommitments = await ctx.db
            .query("commitments")
            .withIndex("by_investorId", (q) => q.eq("investorId", platformInvestorId!))
            .take(10);

        if (existingPlatformCommitments.length === 0) {
            const seeded = await seedPledgesOntoInvestor(ctx, {
                investorId: platformInvestorId!,
                investorName: "Wanjiru Kamau",
                investorEmail: "wanjiru@example.com",
                pledges: demoPledges,
                now,
                writeListingEvent: true,
                ventureIds,
            });
            createdCommitments += seeded.createdCommitments;
            createdCheckIns += seeded.createdCheckIns;
            createdDigests += seeded.createdDigests;
        }

        // Caller's personal desk — this is what Today / Deals actually show.
        const userId = await getAuthUserId(ctx);
        let personalCommitmentId: Id<"commitments"> | null = null;
        let needsAuth = !userId;

        if (userId) {
            const linked = await ensureInvestorForUserId(ctx, userId);
            const existingPersonal = await ctx.db
                .query("commitments")
                .withIndex("by_investorId", (q) => q.eq("investorId", linked.investorId))
                .take(10);

            if (existingPersonal.length === 0) {
                const seeded = await seedPledgesOntoInvestor(ctx, {
                    investorId: linked.investorId,
                    investorName: linked.displayName,
                    investorEmail: linked.email ?? `${linked.investorId}@guest.juakali.demo`,
                    pledges: demoPledges,
                    now,
                    writeListingEvent: false,
                    ventureIds,
                });
                createdCommitments += seeded.createdCommitments;
                createdCheckIns += seeded.createdCheckIns;
                createdDigests += seeded.createdDigests;
                personalCommitmentId = seeded.firstCommitmentId;
            } else {
                personalCommitmentId = existingPersonal[0]!._id;
            }

            await syncInvestorBriefing(ctx, linked.investorId);
            needsAuth = false;
        }

        await syncVentureBrowse(ctx);

        if (needsAuth) {
            return {
                createdInvestors,
                createdVentures,
                createdCommitments,
                createdCheckIns,
                createdDigests,
                commitmentId: null,
                needsAuth: true,
                message: "Sign in to put demo deals on your desk.",
            };
        }

        const alreadyHadDesk =
            createdCommitments === 0 &&
            createdCheckIns === 0 &&
            createdDigests === 0 &&
            personalCommitmentId != null;

        return {
            createdInvestors,
            createdVentures,
            createdCommitments,
            createdCheckIns,
            createdDigests,
            commitmentId: personalCommitmentId,
            needsAuth: false,
            message: alreadyHadDesk
                ? "Demo deals are already on your desk."
                : "Demo deals are on your desk — approve Jua's suggestion to see the loop.",
        };
    },
});

/** Shared pledge/KPI/digest/proposal writer for platform + personal demo desks. */
async function seedPledgesOntoInvestor(
    ctx: MutationCtx,
    args: {
        investorId: Id<"investors">;
        investorName: string;
        investorEmail: string;
        pledges: Array<{
            ventureId: Id<"ventures">;
            amountKes: number;
            currency?: "KES" | "USD" | "NGN" | "GHS" | "PHP" | "IDR" | "INR" | "BRL" | "ZAR";
            shareBps: number;
            thesis: string;
            backdateDays: number;
            checkIns: Array<{ metric: string; value: number; note: string; periodLabel: string }>;
            digest: { summary: string; insights: string };
        }>;
        now: number;
        writeListingEvent: boolean;
        ventureIds: Id<"ventures">[];
    }
) {
    let createdCommitments = 0;
    let createdCheckIns = 0;
    let createdDigests = 0;
    let firstCommitmentId: Id<"commitments"> | null = null;

    for (const pledge of args.pledges) {
        const baseTs = args.now - (pledge.backdateDays ?? 0) * 24 * 60 * 60 * 1000;
        const commitmentId = await ctx.db.insert("commitments", {
            investorId: args.investorId,
            ventureId: pledge.ventureId,
            amountKes: pledge.amountKes,
            shareBps: pledge.shareBps,
            capMultiple: 2,
            status: "active",
            thesis: pledge.thesis,
            nextDigestAt: nextFridayEightEAT(args.now),
            digestCadence: "Weekly · Fri 08:00 EAT",
            createdAt: baseTs + createdCommitments,
            updatedAt: baseTs + createdCommitments,
        });
        if (!firstCommitmentId) firstCommitmentId = commitmentId;
        createdCommitments += 1;

        const venture = await ctx.db.get(pledge.ventureId);
        const agentAddress = venture?.agentEmail ?? "agent@juakali.demo";
        await writeLedgerEvent(ctx, {
            type: "pledge",
            ventureId: pledge.ventureId,
            commitmentId,
            summary: formatPublicPledge(args.investorName, pledge.currency ?? "KES", pledge.amountKes, venture?.name ?? "venture", pledge.shareBps, 2),
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
            investorId: args.investorId,
            direction: "inbound",
            fromAddress: args.investorEmail,
            toAddress: agentAddress,
            subject: `Re: ${venture?.name ?? "venture"} — quick push`,
            body: `Please push follow-ups this week and summarize pipeline for me by Friday.`,
            createdAt: baseTs + 30,
        });
        await ctx.db.insert("agentEmails", {
            commitmentId,
            ventureId: pledge.ventureId,
            investorId: args.investorId,
            direction: "outbound",
            fromAddress: agentAddress,
            toAddress: args.investorEmail,
            subject: `Digest: ${venture?.name ?? "venture"}`,
            body: `${pledge.digest.summary}\n\n${pledge.digest.insights}\n\n— Jua · JuaKali agent (demo email ritual)`,
            createdAt: baseTs + 31,
        });

        if ((pledge.backdateDays ?? 0) > 0 && venture) {
            const commitmentDoc = await ctx.db.get(commitmentId);
            if (commitmentDoc) {
                await createProposalForCommitment(ctx, commitmentDoc, venture, pledge.backdateDays!);
            }
        }
    }

    if (args.writeListingEvent && args.ventureIds[2]) {
        await writeLedgerEvent(ctx, {
            type: "action",
            ventureId: args.ventureIds[2]!,
            summary: "Faith Tailoring Line listed for public investment — seeking first soft pledge for machine servicing.",
            createdAt: args.now + 50,
        });

        const existingWisdom = await ctx.db
            .query("sharedItems")
            .withIndex("by_ventureId_and_status", (q) =>
                q.eq("ventureId", args.ventureIds[0]!).eq("status", "applied")
            )
            .first();
        if (!existingWisdom) {
            const appliedAt = args.now - 4 * 24 * 60 * 60 * 1000;
            await ctx.db.insert("sharedItems", {
                ventureId: args.ventureIds[0]!,
                investorId: args.investorId,
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
                ventureId: args.ventureIds[0]!,
                commitmentId: null,
                summary: `${args.investorName} shared a note with Amina Sales Pod — Jua applied: Run the referral sweep this week`,
                createdAt: appliedAt,
                evidence: ["agent", "note"],
            });
        }
    }

    return { createdCommitments, createdCheckIns, createdDigests, firstCommitmentId };
}


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
            await syncInvestorBriefing(ctx, investorId);
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
        // Same as listVentures: read the global browse index, fall back to
        // the scan only for pre-backfill deployments.
        const browse = await ctx.db.query("ventureBrowse").first();
        if (browse) return { ventures: browse.ventures };
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
            /** ISO currency of the totals (default KES). */
            currency: currencyCodeValidator,
            checkIns: v.number(),
            activeVentures: v.number(),
            digests: v.number(),
        }),
    }),
    handler: async (ctx, args) => {
        const limit = Math.min(Math.max(args.limit ?? 40, 1), 100);
        const rows = await ctx.db.query("ledgerEvents").withIndex("by_createdAt").order("desc").take(limit * 2);
        // Legacy rows lack the denormalized metadata; resolve lazily with a
        // per-handler cache so a legacy feed never degrades into N+1 reads.
        const ventureMeta = new Map<string, { name: string; slug: string } | null>();
        async function metaFor(ventureId: Id<"ventures"> | null | undefined) {
            if (!ventureId) return null;
            const key = String(ventureId);
            let meta = ventureMeta.get(key);
            if (meta === undefined) {
                const venture = await ctx.db.get(ventureId);
                meta = venture ? { name: venture.name, slug: venture.publicSlug } : null;
                ventureMeta.set(key, meta);
            }
            return meta;
        }
        const events = [];
        for (const row of rows) {
            if (!row.publicVisible) continue;
            const meta = await metaFor(row.ventureId);
            events.push({
                id: row._id,
                type: row.type,
                summary: row.summary,
                amountKes: row.amountKes ?? null,
                metric: row.metric ?? null,
                value: row.value ?? null,
                ventureName: row.ventureName ?? meta?.name ?? null,
                ventureSlug: row.ventureSlug ?? meta?.slug ?? null,
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
                currency: "KES" as const,
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
        /** ISO currency for this deal (default KES while Kenya is the only market). */
        currency: v.optional(currencyCodeValidator),
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
        if (!Number.isFinite(args.amountKes) || Math.round(args.amountKes) <= 0) throw new Error("Pledge must round to at least 1.");

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
        const currency = args.currency ?? "KES";
        const thesis =
            args.thesis?.trim() ||
            `Soft revenue-share pledge into ${venture.name}: ${(shareBps / 100).toFixed(1)}% of cashflow until ${capMultiple}×.`;

        const commitmentId = await ctx.db.insert("commitments", {
            investorId,
            ventureId,
            amountKes: Math.round(args.amountKes),
            currency,
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
            summary: formatPublicPledge(investor.displayName, currency, args.amountKes, venture.name, shareBps, capMultiple),
            amountKes: Math.round(args.amountKes),
            createdAt: now,
        });
        // A new commitment affects the briefing's next-scheduled digest.
        await syncInvestorBriefing(ctx, investorId);

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
        // The cockpit projection's check-ins + venture summary must refresh,
        // and the KPI changes the browse index's kpiLatest/kpiTotal.
        await syncInvestorsForVenture(ctx, ventureId);
        await syncVentureBrowse(ctx);

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
        // The cockpit projection's latest digest must refresh.
        await syncInvestorBriefing(ctx, commitment.investorId);

        return {
            digestId,
            message: `Digest created for ${venture.name}.`,
        };
    },
});
