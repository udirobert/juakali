import { action, mutation, query } from "./_generated/server";
import {
    customQuery,
    customCtx,
    customMutation,
    customAction,
} from "convex-helpers/server/customFunctions";
import { getAuthUserId } from "@convex-dev/auth/server";

// =============================================================================
// ROW-LEVEL SECURITY (optional)
// =============================================================================
// To enable RLS, uncomment the imports below and the wrapDatabaseReader/Writer
// calls inside each custom function. Then define your rules in rules.ts.
//
// import { wrapDatabaseReader, wrapDatabaseWriter } from "convex-helpers/server/rowLevelSecurity";
// import { rules } from "./rules";
// import type { DataModel } from "./_generated/dataModel";

export const authQuery = customQuery(
    query,
    customCtx(async (ctx) => {
        const userId = await getAuthUserId(ctx);
        if (!userId) throw new Error("Authentication required");
        const user = await ctx.db.get(userId);
        if (!user) throw new Error("User not found");
        return {
            user,
            // Uncomment to enable RLS on reads:
            // db: wrapDatabaseReader<DataModel>({ user }, ctx.db, rules),
        };
    })
);

export const authMutation = customMutation(
    mutation,
    customCtx(async (ctx) => {
        const userId = await getAuthUserId(ctx);
        if (!userId) throw new Error("Authentication required");
        const user = await ctx.db.get(userId);
        if (!user) throw new Error("User not found");
        return {
            user,
            // Uncomment to enable RLS on reads + writes:
            // db: wrapDatabaseWriter<DataModel>({ user }, ctx.db, rules),
        };
    })
);

export const authAction = customAction(
    action,
    customCtx(async (ctx) => {
        const userId = await getAuthUserId(ctx);
        if (!userId) throw new Error("Authentication required");
        return { userId };
    })
);
