import { createEnv } from "convex-env";
import { v } from "convex/values";

/**
 * Detect whether Bloom-managed env vars have been provisioned yet.
 *
 * Bloom writes a small set of env vars to your Convex deployment shortly
 * after creation (`SITE_URL`, `BLOOM_TRUSTED_ORIGINS`, `BLOOM_PROJECT_ENV`)
 * and keeps them in sync from then on (e.g. when you publish,
 * `BLOOM_PROJECT_ENV` transitions to `"published"`). There is a brief
 * window between deployment creation and the first sync where they're
 * absent.
 *
 * We use `BLOOM_PROJECT_ENV` as the marker: if it's absent, we're in that
 * pre-provisioning gap and relax validation on every Bloom-managed key so
 * the backend boots cleanly. Once Bloom has populated them, the full
 * schema's strict validation takes effect.
 */
function isPreProvisioning(): boolean {
    return !process.env.BLOOM_PROJECT_ENV;
}

// =============================================================================
// SINGLE SOURCE OF TRUTH: full schema (steady state, post-provisioning)
// =============================================================================
// Add every env var your backend reads here -- both ones you reference directly
// (env.SOMETHING) and ones third-party libraries read implicitly via
// process.env. Declaring them documents the dependency and validates them at
// startup, so a missing or mistyped value fails loud instead of silently
// breaking auth, payments, or webhooks.
const fullSchema = {
    // ---- Bloom-managed (set automatically by Bloom; see isPreProvisioning) --

    // Deployment role of THIS Convex deployment from Bloom's perspective.
    // The deployment is scoped to (project, branch) -- one dev deployment
    // per branch, one prod deployment per project -- so this marker is a
    // project-level signal, not an app-level one.
    // - "preview"        — main preview deployment of an unpublished bloom
    // - "feature_branch" — preview deployment for a feature branch
    // - "published"      — production deployment (post-publish)
    // Branch on this for environment-specific behaviour. Example:
    //   if (env.BLOOM_PROJECT_ENV === "published") { /* real email send */ }
    //   else                                       { /* dry-run / log only */ }
    BLOOM_PROJECT_ENV: v.union(
        v.literal("preview"),
        v.literal("feature_branch"),
        v.literal("published")
    ),

    // Public-facing site URL used by Convex Auth for OAuth redirect callbacks.
    SITE_URL: v.string(),

    // ---- User-managed examples (uncomment + adapt as you add features) -----
    // Required string -- backend won't boot without it once provisioning is
    // complete and you've set it via `bunx convex env set OPENAI_API_KEY ...`.
    // OPENAI_API_KEY: v.string(),
    //
    // Numeric env var (convex-env parses the string for you).
    // FREE_REQUESTS_PER_USER: v.number(),
    //
    // Boolean toggle (parses "true"/"false" automatically).
    // DEBUG_MODE: v.optional(v.boolean()),
    //
    // Constrained literal union.
    // LOG_LEVEL: v.optional(v.union(v.literal("debug"), v.literal("info"))),
} as const;

// =============================================================================
// TYPE INFERENCE: derive TypeScript type from schema
// =============================================================================
type SchemaEnvType = ReturnType<typeof createEnv<typeof fullSchema>>;

// Convex auto-injects CONVEX_SITE_URL and CONVEX_CLOUD_URL on every
// deployment. They're not in our schema (we don't validate them) but are
// always available at runtime, so we add them to the exported type.
type FullEnvType = SchemaEnvType & {
    CONVEX_SITE_URL: string;
    CONVEX_CLOUD_URL: string;
};

// =============================================================================
// PROVISIONING-GAP RELAXATION: keys Bloom writes asynchronously
// =============================================================================
// During the brief window before Bloom's first sync to your deployment,
// these keys are absent. Once the first sync completes, they are always
// present. Listed here so the backend can boot during the gap; once Bloom
// has populated them, the full schema's strict validation applies.
const bloomManagedKeys = ["BLOOM_PROJECT_ENV", "SITE_URL"] as const;

type SchemaValue = (typeof fullSchema)[keyof typeof fullSchema];

function buildRuntimeSchema(): Record<string, SchemaValue> {
    const schema: Record<string, SchemaValue> = { ...fullSchema };
    if (isPreProvisioning()) {
        for (const key of bloomManagedKeys) {
            const validator = fullSchema[key];
            // Two casts here: convex-env's `v.optional()` widens the runtime
            // validator from `"required"` to `"optional"`, which TypeScript
            // sees as a different shape than the union of `fullSchema`'s
            // entries. The schema map at runtime is keyed by string and
            // accepts either, but at the type layer we need to nudge TS
            // through both directions. Funnel-pointed in this one helper so
            // call sites stay type-safe; this is the only place either cast
            // appears.
            schema[key] = v.optional(
                validator as ReturnType<typeof v.string>
            ) as unknown as SchemaValue;
        }
    }
    return schema;
}

// =============================================================================
// EXPORT: typed environment variables
// =============================================================================
/**
 * Typed environment variables. `fullSchema` is the single source of truth --
 * both the TypeScript type and the runtime validation are derived from it.
 *
 * Use `env.SOMETHING` instead of `process.env.SOMETHING` so missing or
 * mistyped values fail at startup rather than silently propagating
 * undefined into auth/payment/webhook code paths.
 */
export const env = createEnv(buildRuntimeSchema()) as FullEnvType;
