import { Migrations } from "@convex-dev/migrations";
import { DataModel } from "./_generated/dataModel";
import { components } from "./_generated/api";
import { syncInvestorBriefing, syncVentureBrowse } from "./investorBriefing";

const migrations = new Migrations<DataModel>(components.migrations);

export const run = migrations.runner();

/**
 * Backfill the denormalized investorBriefings index for every existing
 * investor (run once after deploying the index: `npx convex run migrations:backfillInvestorBriefings`).
 * New investors converge on their first run/commitment mutation, so this only
 * catches pre-existing accounts.
 */
export const backfillInvestorBriefings = migrations.define({
    table: "investors",
    migrateOne: async (ctx, doc) => {
        await syncInvestorBriefing(ctx, doc._id);
    },
});

/**
 * Backfill the denormalized ventureName/ventureSlug on ledger events written
 * before the public-ledger index existed (run once after deploying:
 * `npx convex run migrations:backfillLedgerEventVentureMeta`). New events embed
 * the metadata at write time, and publicLedger falls back to a cached venture
 * lookup until this runs.
 */
export const backfillLedgerEventVentureMeta = migrations.define({
    table: "ledgerEvents",
    migrateOne: async (ctx, doc) => {
        if (doc.ventureName != null && doc.ventureSlug != null) return;
        if (!doc.ventureId) return;
        const venture = await ctx.db.get(doc.ventureId);
        if (!venture) return;
        if (doc.ventureName === venture.name && doc.ventureSlug === venture.publicSlug) return;
        return { ventureName: venture.name, ventureSlug: venture.publicSlug };
    },
});

/**
 * Backfill the global ventureBrowse index for deployments that predate it
 * (run once after deploying: `npx convex run migrations:backfillVentureBrowse`).
 * New ventures/pledges/KPI records sync the doc at write time; this builds it
 * once for existing data. Runs over the ventures table but only the first
 * document does the work — the doc is a singleton.
 */
export const backfillVentureBrowse = migrations.define({
    table: "ventures",
    migrateOne: async (ctx) => {
        const existing = await ctx.db.query("ventureBrowse").first();
        if (existing) return;
        await syncVentureBrowse(ctx);
    },
});

// =============================================================================
// DEFINING MIGRATIONS
// =============================================================================
// Use migrations.define() to create migrations that process documents in batches.
// Each migration is idempotent and tracks progress by function name.
//
// IMPORTANT: Never rename migration functions after they've been run.
//
// Example: Backfill a new required field
//
// export const backfillCreatedAt = migrations.define({
//   table: "posts",
//   migrateOne: async (_ctx, doc) => {
//     if (doc.createdAt === undefined) {
//       return { createdAt: doc._creationTime };
//     }
//   },
// });
//
// Run a specific migration:
//   export const runBackfillCreatedAt = migrations.runner([backfillCreatedAt]);
//
// Run via convex_run tool:
//   functionName: "migrations:run"
//   args: {}                                          // run all pending
//   args: { fn: "migrations:backfillCreatedAt" }      // run specific
//   args: { dryRun: true }                            // dry run (one batch, no commit)
