import { RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";

export const rateLimiter = new RateLimiter(components.rateLimiter, {
    // Define rate limits here. Each key becomes a named limit you can check/consume.
    // Import MINUTE, HOUR, SECOND from "@convex-dev/rate-limiter" for period values.
    //
    // sendMessage: { kind: "token bucket", rate: 10, period: MINUTE, capacity: 15 },
    // createAccount: { kind: "fixed window", rate: 5, period: HOUR },
    // apiCall: { kind: "token bucket", rate: 100, period: MINUTE },
});

// =============================================================================
// USAGE IN MUTATIONS
// =============================================================================
// Import this rateLimiter in your mutations to enforce limits:
//
// import { rateLimiter } from "./rateLimit";
//
// export const sendMessage = authMutation({
//   args: { text: v.string() },
//   returns: v.null(),
//   handler: async (ctx, args) => {
//     await rateLimiter.limit(ctx, "sendMessage", { key: ctx.user._id });
//     await ctx.db.insert("messages", { text: args.text, userId: ctx.user._id });
//     return null;
//   },
// });
