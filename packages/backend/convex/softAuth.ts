import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
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
        };
    },
});

export const setMyPrefs = mutation({
    args: {
        onboarded: v.optional(v.boolean()),
        coachDismissed: v.optional(v.boolean()),
        lastOrientedAt: v.optional(v.union(v.number(), v.null())),
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
                updatedAt: now,
            });
        } else {
            await ctx.db.insert("userPrefs", {
                userId,
                onboarded: args.onboarded ?? false,
                coachDismissed: args.coachDismissed ?? false,
                lastOrientedAt: nextOriented,
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
