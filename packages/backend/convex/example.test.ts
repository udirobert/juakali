// import { convexTest } from "convex-test";
// import { expect, test, describe, vi } from "vitest";
// import { api, internal } from "./_generated/api";
// import schema from "./schema";

// =============================================================================
// 1. AUTH + OWNERSHIP ENFORCEMENT
// =============================================================================
// Test that authenticated users can only access their own data.
// The subject field must match Better Auth's "userId|sessionId" format.
//
// async function createAuthUser(t: ReturnType<typeof convexTest>, email: string) {
//   const userId = await t.run(async (ctx) => {
//     return await ctx.db.insert("users", { email, name: email.split("@")[0], createdAt: Date.now() });
//   });
//   const asUser = t.withIdentity({
//     subject: `${userId}|fake-session`,
//     issuer: "https://test.convex.dev",
//     tokenIdentifier: `https://test.convex.dev|${userId}|fake-session`,
//   });
//   return { userId, asUser };
// }
//
// describe("post ownership", () => {
//   test("alice sees her posts, bob sees nothing", async () => {
//     const t = convexTest(schema);
//     const { userId: aliceId, asUser: asAlice } = await createAuthUser(t, "alice@test.com");
//     const { asUser: asBob } = await createAuthUser(t, "bob@test.com");
//
//     await t.run(async (ctx) => {
//       await ctx.db.insert("posts", { userId: aliceId, title: "Private thought", body: "..." });
//     });
//
//     expect(await asAlice.query(api.posts.listMine, {})).toHaveLength(1);
//     expect(await asBob.query(api.posts.listMine, {})).toHaveLength(0);
//   });
//
//   test("unauthenticated caller is rejected", async () => {
//     const t = convexTest(schema);
//     await expect(t.query(api.posts.listMine, {})).rejects.toThrow("Authentication required");
//   });
// });

// =============================================================================
// 2. SCHEDULED FUNCTION CHAINS (async workflows)
// =============================================================================
// When a mutation schedules follow-up actions via ctx.scheduler.runAfter(),
// use fake timers + finishAllScheduledFunctions to drain the entire async chain.
// This is essential for testing patterns like: user action -> background job -> write result.
//
// describe("async AI response", () => {
//   test("sending a message triggers an AI reply", async () => {
//     const t = convexTest(schema);
//     vi.useFakeTimers();
//     try {
//       const { asUser } = await createAuthUser(t, "alice@test.com");
//
//       // send() schedules generateAIResponse via ctx.scheduler.runAfter(0, ...)
//       await asUser.mutation(api.messages.send, { text: "Hello AI" });
//
//       // Drain ALL scheduled functions (the action + any mutations it calls back to)
//       await t.finishAllScheduledFunctions(vi.runAllTimers);
//
//       const messages = await asUser.query(api.messages.list, {});
//       expect(messages).toHaveLength(2); // original + AI response
//       expect(messages[1].author).toBe("ai");
//     } finally {
//       vi.useRealTimers();
//     }
//   });
// });

// =============================================================================
// 3. COMPONENT INTEGRATION (testing with Convex components)
// =============================================================================
// Register pre-installed Convex components so your tests exercise
// the real component logic (rate limiting, migrations, aggregation, etc).
//
// import rateLimiterSchema from "@convex-dev/rate-limiter/src/component/schema";
// const rateLimiterModules = import.meta.glob(
//   "../../node_modules/@convex-dev/rate-limiter/src/component/**/*.ts"
// );
//
// function initTestWithComponents() {
//   const t = convexTest(schema, import.meta.glob("./**/*.*s"));
//   t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
//   // Register more components as needed:
//   // t.registerComponent("migrations", migrationsSchema, migrationsModules);
//   return t;
// }
//
// describe("rate limiting", () => {
//   test("blocks excessive requests", async () => {
//     const t = initTestWithComponents();
//     const { asUser } = await createAuthUser(t, "spammer@test.com");
//
//     // Send 10 messages (within limit)
//     for (let i = 0; i < 10; i++) {
//       await asUser.mutation(api.messages.send, { text: `msg ${i}` });
//     }
//
//     // 11th should be rate limited
//     await expect(
//       asUser.mutation(api.messages.send, { text: "one too many" })
//     ).rejects.toThrow(/rate limit/i);
//   });
// });
