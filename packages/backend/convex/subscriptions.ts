import { internalMutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * RevenueCat entitlements (Shipaton 2026 monetization).
 *
 * `revenueCatAppUserId` is the Convex `investors` id, set as the RevenueCat
 * `app_user_id` when the client configures the SDK. The RevenueCat webhook
 * (`POST /webhooks/revenuecat`, Bearer-secret signed) calls `setEntitlements`
 * so entitlements are updated server-side and are authoritative.
 */

/** Current user's entitlements (null when signed out / no subscription yet). */
export const getMyEntitlements = query({
    args: {},
    returns: v.union(
        v.null(),
        v.object({
            entitlements: v.array(v.string()),
            productId: v.union(v.string(), v.null()),
            status: v.union(v.literal("active"), v.literal("expired")),
            expiresAt: v.union(v.number(), v.null()),
            updatedAt: v.number(),
        })
    ),
    handler: async (ctx) => {
        const userId = await getAuthUserId(ctx);
        if (!userId) return null;
        const investor = await ctx.db
            .query("investors")
            .withIndex("by_userId", (q) => q.eq("userId", userId))
            .first();
        if (!investor) return null;
        const sub = await ctx.db
            .query("subscriptions")
            .withIndex("by_investorId", (q) => q.eq("investorId", investor._id))
            .first();
        if (!sub) return null;
        return {
            entitlements: sub.entitlements,
            productId: sub.productId,
            status: sub.status,
            expiresAt: sub.expiresAt,
            updatedAt: sub.updatedAt,
        };
    },
});

/** Upsert entitlements from the RevenueCat webhook (runs with admin privileges). */
export const setEntitlements = internalMutation({
    args: {
        revenueCatAppUserId: v.string(),
        entitlements: v.array(v.string()),
        productId: v.union(v.string(), v.null()),
        status: v.union(v.literal("active"), v.literal("expired")),
        expiresAt: v.union(v.number(), v.null()),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        const existing = await ctx.db
            .query("subscriptions")
            .withIndex("by_revenueCatAppUserId", (q) =>
                q.eq("revenueCatAppUserId", args.revenueCatAppUserId)
            )
            .first();
        if (existing) {
            await ctx.db.patch(existing._id, {
                entitlements: args.entitlements,
                productId: args.productId,
                status: args.status,
                expiresAt: args.expiresAt,
                updatedAt: now,
            });
            return;
        }
        const investorId = toInvestorId(args.revenueCatAppUserId);
        if (!investorId) return;
        await ctx.db.insert("subscriptions", {
            investorId,
            revenueCatAppUserId: args.revenueCatAppUserId,
            entitlements: args.entitlements,
            productId: args.productId,
            status: args.status,
            expiresAt: args.expiresAt,
            updatedAt: now,
        });
    },
});

/** Best-effort parse of the RevenueCat app_user_id (a Convex investors id). */
function toInvestorId(appUserId: string): Id<"investors"> | null {
    if (typeof appUserId !== "string" || appUserId.length === 0) return null;
    if (!appUserId.includes(":")) return null;
    return appUserId as Id<"investors">;
}