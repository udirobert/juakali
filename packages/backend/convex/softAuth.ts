import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { rateLimiter } from "./rateLimit";

 
export function softAuthInboxEnabled() {
    return process.env.SOFT_AUTH_INBOX === "1";
}

export function requireAuthToActEnabled() {
    return process.env.REQUIRE_AUTH_TO_ACT === "1";
}
 

/** Server-side act gate for pledge / approve / start commitment. */
export async function assertCanAct(ctx: MutationCtx) {
    if (!requireAuthToActEnabled()) return;
    const userId = await getAuthUserId(ctx);
    if (!userId) {
        throw new Error("Sign in required to act on deals. Use soft email identity first.");
    }
}

/** Ownership gate for investor mutations, independent of the soft-auth flag. */
export async function assertInvestorOwnsCommitment(
    ctx: MutationCtx,
    commitmentId: Id<"commitments">
): Promise<Id<"investors">> {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Authentication required");
    const commitment = await ctx.db.get(commitmentId);
    if (!commitment) throw new Error("Commitment not found");
    const investor = await ctx.db.get(commitment.investorId);
    if (!investor || investor.userId !== userId) {
        throw new Error("You do not own this commitment");
    }
    return investor._id;
}

export async function assertInvestorOwnsRun(
    ctx: MutationCtx,
    run: Doc<"agentRuns">
): Promise<Id<"investors">> {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Authentication required");
    const investor = await ctx.db.get(run.investorId);
    if (!investor || investor.userId !== userId) {
        throw new Error("You do not own this investor run");
    }
    return investor._id;
}

/** Ownership gate for investor settings. */
export async function assertInvestorOwnsInvestor(
    ctx: MutationCtx,
    investorId: Id<"investors">
): Promise<void> {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Authentication required");
    const investor = await ctx.db.get(investorId);
    if (!investor || investor.userId !== userId) {
        throw new Error("You do not own this investor profile");
    }
}

/** Read gate for private investor run/proposal details. */
export async function canReadInvestorRun(
    ctx: QueryCtx,
    run: Doc<"agentRuns">
): Promise<boolean> {
    const userId = await getAuthUserId(ctx);
    if (!userId) return false;
    const investor = await ctx.db.get(run.investorId);
    return investor?.userId === userId;
}

/** Venture-owner gate for founder-originated evidence. */
export async function assertVentureOwner(
    ctx: MutationCtx,
    ventureId: Id<"ventures">
): Promise<Id<"users">> {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Authentication required");
    const owner = await ctx.db
        .query("ventureOwners")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .first();
    if (!owner || owner.ventureId !== ventureId) {
        throw new Error("You do not own this venture");
    }
    return userId;
}

export const storeLink = internalMutation({
    args: {
        email: v.string(),
        url: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const email = args.email.trim().toLowerCase();
        const now = Date.now();
        const existing = await ctx.db
            .query("softAuthLinks")
            .withIndex("by_email", (q) => q.eq("email", email))
            .collect();
        for (const row of existing) {
            await ctx.db.delete(row._id);
        }
        await ctx.db.insert("softAuthLinks", {
            email,
            url: args.url,
            createdAt: now,
        });
        return null;
    },
});

/** Demo-only: peek latest magic link for an email (SOFT_AUTH_INBOX=1). */
export const peekSoftAuthLink = query({
    args: { email: v.string() },
    returns: v.union(
        v.null(),
        v.object({
            url: v.string(),
            createdAt: v.number(),
            enabled: v.literal(true),
        }),
        v.object({ enabled: v.literal(false) })
    ),
    handler: async (ctx, args) => {
        if (!softAuthInboxEnabled()) {
            return { enabled: false as const };
        }
        const email = args.email.trim().toLowerCase();
        if (!email.includes("@")) return null;
        const row = await ctx.db
            .query("softAuthLinks")
            .withIndex("by_email", (q) => q.eq("email", email))
            .order("desc")
            .first();
        if (!row) return null;
        // Expire after 24h
        if (Date.now() - row.createdAt > 60 * 60 * 24 * 1000) return null;
        return { enabled: true as const, url: row.url, createdAt: row.createdAt };
    },
});

export const softAuthConfig = query({
    args: {},
    returns: v.object({
        inboxPeek: v.boolean(),
        requireAuthToAct: v.boolean(),
        resendConfigured: v.boolean(),
    }),
    handler: async () => {
         
        return {
            inboxPeek: softAuthInboxEnabled(),
            requireAuthToAct: requireAuthToActEnabled(),
            resendConfigured: Boolean(process.env.AUTH_RESEND_KEY),
        };
         
    },
});

/** Link signed-in user → investors row (by email / userId). */
export const ensureMyInvestor = mutation({
    args: {
        displayName: v.optional(v.string()),
    },
    returns: v.object({
        investorId: v.id("investors"),
        email: v.union(v.string(), v.null()),
        message: v.string(),
    }),
    handler: async (ctx, args) => {
        await rateLimiter.limit(ctx, "investMutate", { key: "ensureInvestor" });
        const userId = await getAuthUserId(ctx);
        if (!userId) throw new Error("Authentication required");
        const user = await ctx.db.get(userId);
        if (!user) throw new Error("User not found");

        const email = typeof user.email === "string" ? user.email.trim().toLowerCase() : null;
        const displayName =
            args.displayName?.trim() ||
            (typeof user.name === "string" && user.name.trim()) ||
            (email ? email.split("@")[0]! : "Investor");

        const byUser = await ctx.db
            .query("investors")
            .withIndex("by_userId", (q) => q.eq("userId", userId))
            .first();
        if (byUser) {
            await ctx.db.patch(byUser._id, {
                displayName: displayName || byUser.displayName,
                email: email ?? byUser.email ?? null,
            });
            return {
                investorId: byUser._id,
                email: email ?? byUser.email ?? null,
                message: "Investor linked.",
            };
        }

        if (email) {
            const byEmail = await ctx.db
                .query("investors")
                .withIndex("by_email", (q) => q.eq("email", email))
                .first();
            if (byEmail) {
                await ctx.db.patch(byEmail._id, {
                    userId,
                    displayName: displayName || byEmail.displayName,
                });
                return {
                    investorId: byEmail._id,
                    email,
                    message: "Investor linked to your email.",
                };
            }
        }

        const investorId = await ctx.db.insert("investors", {
            displayName,
            email,
            phone: null,
            userId,
            isDefaultDemo: false,
            createdAt: Date.now(),
        });
        return { investorId, email, message: "Investor profile created." };
    },
});

export const getMyPrefs = query({
    args: {},
    returns: v.union(
        v.null(),
        v.object({
            onboarded: v.boolean(),
            coachDismissed: v.boolean(),
            lastOrientedAt: v.union(v.number(), v.null()),
            autonomyLevel: v.union(
                v.literal("ask_every_time"),
                v.literal("auto_low_risk"),
                v.literal("pause_all"),
                v.null()
            ),
        })
    ),
    handler: async (ctx) => {
        const userId = await getAuthUserId(ctx);
        if (!userId) return null;
        const prefs = await ctx.db
            .query("userPrefs")
            .withIndex("by_userId", (q) => q.eq("userId", userId))
            .first();
        if (!prefs) return null;
        return {
            onboarded: prefs.onboarded,
            coachDismissed: prefs.coachDismissed,
            lastOrientedAt: prefs.lastOrientedAt ?? null,
            autonomyLevel: prefs.autonomyLevel ?? null,
        };
    },
});

export const setMyPrefs = mutation({
    args: {
        onboarded: v.optional(v.boolean()),
        coachDismissed: v.optional(v.boolean()),
        lastOrientedAt: v.optional(v.union(v.number(), v.null())),
        autonomyLevel: v.optional(
            v.union(
                v.literal("ask_every_time"),
                v.literal("auto_low_risk"),
                v.literal("pause_all")
            )
        ),
    },
    returns: v.object({ ok: v.boolean() }),
    handler: async (ctx, args) => {
        const userId = await getAuthUserId(ctx);
        if (!userId) throw new Error("Authentication required");
        const existing = await ctx.db
            .query("userPrefs")
            .withIndex("by_userId", (q) => q.eq("userId", userId))
            .first();
        const now = Date.now();
        const nextOriented =
            args.lastOrientedAt === undefined
                ? existing?.lastOrientedAt
                : args.lastOrientedAt === null
                  ? undefined
                  : args.lastOrientedAt;
        if (existing) {
            await ctx.db.patch(existing._id, {
                onboarded: args.onboarded ?? existing.onboarded,
                coachDismissed: args.coachDismissed ?? existing.coachDismissed,
                lastOrientedAt: nextOriented,
                autonomyLevel: args.autonomyLevel ?? existing.autonomyLevel,
                updatedAt: now,
            });
        } else {
            await ctx.db.insert("userPrefs", {
                userId,
                onboarded: args.onboarded ?? false,
                coachDismissed: args.coachDismissed ?? false,
                lastOrientedAt: nextOriented,
                autonomyLevel: args.autonomyLevel,
                updatedAt: now,
            });
        }
        return { ok: true };
    },
});

export const whoAmI = query({
    args: {},
    returns: v.union(
        v.null(),
        v.object({
            userId: v.id("users"),
            email: v.union(v.string(), v.null()),
            name: v.union(v.string(), v.null()),
            investorId: v.union(v.id("investors"), v.null()),
            /** The venture this user runs, if they're on the entrepreneur side. */
            ownedVenture: v.union(
                v.object({ ventureId: v.id("ventures"), name: v.string() }),
                v.null()
            ),
        })
    ),
    handler: async (ctx) => {
        const userId = await getAuthUserId(ctx);
        if (!userId) return null;
        const user = await ctx.db.get(userId);
        if (!user) return null;
        const investor = await ctx.db
            .query("investors")
            .withIndex("by_userId", (q) => q.eq("userId", userId))
            .first();
        const owner = await ctx.db
            .query("ventureOwners")
            .withIndex("by_userId", (q) => q.eq("userId", userId))
            .first();
        const ownedVenture = owner ? await ctx.db.get(owner.ventureId) : null;
        return {
            userId,
            email: typeof user.email === "string" ? user.email : null,
            name: typeof user.name === "string" ? user.name : null,
            investorId: investor?._id ?? null,
            ownedVenture: ownedVenture ? { ventureId: ownedVenture._id, name: ownedVenture.name } : null,
        };
    },
});
