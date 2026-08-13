import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const CONFIG_KEY = "default";
const SECRET_KEY = "webhook";

export const saveConfig = internalMutation({
    args: {
        inboxId: v.string(),
        inboxEmail: v.string(),
        webhookId: v.optional(v.string()),
        webhookSecret: v.optional(v.string()),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const now = Date.now();
        const existing = await ctx.db
            .query("agentMailConfig")
            .withIndex("by_key", (q) => q.eq("key", CONFIG_KEY))
            .first();
        if (existing) {
            await ctx.db.patch(existing._id, {
                inboxId: args.inboxId,
                inboxEmail: args.inboxEmail,
                webhookId: args.webhookId ?? existing.webhookId,
                updatedAt: now,
            });
        } else {
            await ctx.db.insert("agentMailConfig", {
                key: CONFIG_KEY,
                inboxId: args.inboxId,
                inboxEmail: args.inboxEmail,
                webhookId: args.webhookId,
                updatedAt: now,
            });
        }

        if (args.webhookSecret) {
            const secretRow = await ctx.db
                .query("agentMailSecrets")
                .withIndex("by_key", (q) => q.eq("key", SECRET_KEY))
                .first();
            if (secretRow) {
                await ctx.db.patch(secretRow._id, {
                    value: args.webhookSecret,
                    updatedAt: now,
                });
            } else {
                await ctx.db.insert("agentMailSecrets", {
                    key: SECRET_KEY,
                    value: args.webhookSecret,
                    updatedAt: now,
                });
            }
        }
        return null;
    },
});

export const getConfig = internalQuery({
    args: {},
    returns: v.union(
        v.null(),
        v.object({
            inboxId: v.string(),
            inboxEmail: v.string(),
            webhookId: v.union(v.string(), v.null()),
        })
    ),
    handler: async (ctx) => {
        const row = await ctx.db
            .query("agentMailConfig")
            .withIndex("by_key", (q) => q.eq("key", CONFIG_KEY))
            .first();
        if (!row) return null;
        return {
            inboxId: row.inboxId,
            inboxEmail: row.inboxEmail,
            webhookId: row.webhookId ?? null,
        };
    },
});

export const getWebhookSecret = internalQuery({
    args: {},
    returns: v.union(v.string(), v.null()),
    handler: async (ctx) => {
        const row = await ctx.db
            .query("agentMailSecrets")
            .withIndex("by_key", (q) => q.eq("key", SECRET_KEY))
            .first();
        return row?.value ?? null;
    },
});

export const hasWebhookSecret = internalQuery({
    args: {},
    returns: v.boolean(),
    handler: async (ctx) => {
        const row = await ctx.db
            .query("agentMailSecrets")
            .withIndex("by_key", (q) => q.eq("key", SECRET_KEY))
            .first();
        return Boolean(row?.value);
    },
});
