import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

/** One-off: backfill fundedAmount on commitments funded before the field existed. */
export const backfillFundedAmount = internalMutation({
    args: { commitmentId: v.id("commitments"), fundedAmount: v.number() },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.commitmentId, { fundedAmount: args.fundedAmount });
        return "ok";
    },
});
