/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentMail from "../agentMail.js";
import type * as agentMailPublic from "../agentMailPublic.js";
import type * as agentMailStore from "../agentMailStore.js";
import type * as auth from "../auth.js";
import type * as crons from "../crons.js";
import type * as env from "../env.js";
import type * as functions from "../functions.js";
import type * as http from "../http.js";
import type * as invest from "../invest.js";
import type * as juaKaliHelpers from "../juaKaliHelpers.js";
import type * as migrations from "../migrations.js";
import type * as rateLimit from "../rateLimit.js";
import type * as smsDelivery from "../smsDelivery.js";
import type * as softAuth from "../softAuth.js";
import type * as softEmail from "../softEmail.js";
import type * as telephony from "../telephony.js";
import type * as voiceProcessing from "../voiceProcessing.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentMail: typeof agentMail;
  agentMailPublic: typeof agentMailPublic;
  agentMailStore: typeof agentMailStore;
  auth: typeof auth;
  crons: typeof crons;
  env: typeof env;
  functions: typeof functions;
  http: typeof http;
  invest: typeof invest;
  juaKaliHelpers: typeof juaKaliHelpers;
  migrations: typeof migrations;
  rateLimit: typeof rateLimit;
  smsDelivery: typeof smsDelivery;
  softAuth: typeof softAuth;
  softEmail: typeof softEmail;
  telephony: typeof telephony;
  voiceProcessing: typeof voiceProcessing;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  actionCache: import("@convex-dev/action-cache/_generated/component.js").ComponentApi<"actionCache">;
  migrations: import("@convex-dev/migrations/_generated/component.js").ComponentApi<"migrations">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  pushNotifications: import("@convex-dev/expo-push-notifications/_generated/component.js").ComponentApi<"pushNotifications">;
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
  rag: import("@convex-dev/rag/_generated/component.js").ComponentApi<"rag">;
  crons: import("@convex-dev/crons/_generated/component.js").ComponentApi<"crons">;
  shardedCounter: import("@convex-dev/sharded-counter/_generated/component.js").ComponentApi<"shardedCounter">;
  aggregate: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"aggregate">;
};
