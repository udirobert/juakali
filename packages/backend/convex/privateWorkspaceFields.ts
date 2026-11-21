/**
 * Shared validators for the private backer–venture-lead workspace.
 * Pure value definitions only — no ctx, no queries — so schema, query
 * validators, and mutation args stay in sync.
 */
import { v } from "convex/values";

export const measurePrecisionValidator = v.union(
    v.literal("whole"),
    v.literal("decimal")
);

/** What the lead tracks — free text, no industry enum anywhere. */
export const measureValidator = v.object({
    label: v.string(),
    unit: v.string(),
    precision: measurePrecisionValidator,
});

export const supportKindValidator = v.union(
    v.literal("undecided"),
    v.literal("gift"),
    v.literal("loan"),
    v.literal("revenue_share")
);

export const requestKindValidator = v.union(
    v.literal("supplier"),
    v.literal("introduction"),
    v.literal("pricing"),
    v.literal("feedback"),
    v.literal("other")
);

export const responseValidator = v.union(
    v.literal("help"),
    v.literal("talk"),
    v.literal("pass")
);

export const outcomeValidator = v.union(v.literal("helped"), v.literal("not_yet"));

export const workspaceRoleValidator = v.union(
    v.literal("backer"),
    v.literal("lead")
);
