import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

/**
 * Share-card data for GET /share/ledger?slug=<public-slug>.
 * Internal (not api.*) because it's only reachable from the HTTP action.
 */
export const getShareData = internalQuery({
    args: { slug: v.string() },
    handler: async (ctx, args) => {
        const venture = await ctx.db
            .query("ventures")
            .withIndex("by_publicSlug", (q) => q.eq("publicSlug", args.slug))
            .first();
        if (!venture) return null;

        const commitments = await ctx.db.query("commitments").order("desc").take(200);
        const pledgedKes = commitments
            .filter((row) => row.ventureId === venture._id)
            .reduce((sum, row) => sum + row.amountKes, 0);

        // Count KPIs + digests off bounded index scans (no full-table order scan).
        let checkIns = 0;
        const checkInCursor = ctx.db
            .query("kpiCheckIns")
            .withIndex("by_ventureId", (q) => q.eq("ventureId", venture._id));
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _row of checkInCursor) {
            checkIns += 1;
            if (checkIns >= 1000) break;
        }

        let digests = 0;
        const digestCursor = ctx.db
            .query("agentDigests")
            .withIndex("by_ventureId", (q) => q.eq("ventureId", venture._id));
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _row of digestCursor) {
            digests += 1;
            if (digests >= 1000) break;
        }

        return {
            ventureName: venture.name,
            slug: venture.publicSlug,
            pledgedKes,
            checkIns,
            digests,
        };
    },
});
