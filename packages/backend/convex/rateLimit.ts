import { RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";
import { MINUTE, HOUR } from "@convex-dev/rate-limiter";

export const rateLimiter = new RateLimiter(components.rateLimiter, {
    // SMS/webhook: 30 requests per minute per phone number
    smsWebhook: { kind: "token bucket", rate: 30, period: MINUTE, capacity: 40 },
    // USSD: 10 requests per minute per phone number
    ussdWebhook: { kind: "token bucket", rate: 10, period: MINUTE, capacity: 15 },
    // Voice intake: 5 recordings per hour per phone number
    voiceWebhook: { kind: "fixed window", rate: 5, period: HOUR },
    // Master registration: 10 per hour per phone
    registerMaster: { kind: "token bucket", rate: 10, period: HOUR, capacity: 12 },
    // Apprentice matching: 20 per hour per phone
    matchApprentice: { kind: "token bucket", rate: 20, period: HOUR, capacity: 25 },
    // Dashboard queries: 60 per minute per user
    dashboardQuery: { kind: "token bucket", rate: 60, period: MINUTE, capacity: 80 },
    // SMS queueing: 30 per minute per phone
    queueSms: { kind: "token bucket", rate: 30, period: MINUTE, capacity: 40 },
});

// =============================================================================
// USAGE IN MUTATIONS / QUERIES
// =============================================================================
// Import this rateLimiter in your mutations/queries:
//
// import { rateLimiter } from "./rateLimit";
//
// export const myMutation = mutation({
//   args: { ... },
//   handler: async (ctx, args) => {
//     await rateLimiter.limit(ctx, "smsWebhook", { key: ctx.values.phoneNumber });
//     // ... rest of handler
//   },
// });
