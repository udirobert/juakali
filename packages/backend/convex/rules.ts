// =============================================================================
// ROW-LEVEL SECURITY (RLS)
// =============================================================================
// Define per-table access rules to enforce data ownership at the database level.
// When integrated with functions.ts, every authQuery/authMutation automatically
// respects these rules -- no manual checks needed in each handler.
//
// See: https://stack.convex.dev/row-level-security
//
// import type { DataModel } from "./_generated/dataModel";
// import type { Rules } from "convex-helpers/server/rowLevelSecurity";
//
// export const rules: Rules<DataModel, { user: Doc<"users"> }> = {
//   // Example: Users can only read/modify their own posts
//   // posts: {
//   //   read: async ({ user }, doc) => doc.userId === user._id,
//   //   modify: async ({ user }, doc) => doc.userId === user._id,
//   //   insert: async ({ user }, doc) => doc.userId === user._id,
//   // },
// };
