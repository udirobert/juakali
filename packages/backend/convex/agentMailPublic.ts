import { v } from "convex/values";
import { query } from "./_generated/server";

/** Public-safe AgentMail wiring status (no secrets). */
export const publicStatus = query({
    args: {},
    returns: v.object({
        configured: v.boolean(),
        inboxEmail: v.union(v.string(), v.null()),
        inboxId: v.union(v.string(), v.null()),
        webhookId: v.union(v.string(), v.null()),
        webhookUrl: v.string(),
    }),
    handler: async (ctx) => {
        const row = await ctx.db
            .query("agentMailConfig")
            .withIndex("by_key", (q) => q.eq("key", "default"))
            .first();
         
        const site = (process.env.CONVEX_SITE_URL ?? "").replace(/\/$/, "");
         
        return {
            configured: Boolean(row?.inboxId),
            inboxEmail: row?.inboxEmail ?? null,
            inboxId: row?.inboxId ?? null,
            webhookId: row?.webhookId ?? null,
            webhookUrl: `${site}/webhooks/agentmail`,
        };
    },
});
