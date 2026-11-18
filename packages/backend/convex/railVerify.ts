/**
 * Rail-backed evidence verification — the bridge between PaymentRail adapters
 * and the evidence ladder.
 *
 * The founder submits a statement artifact (M-PESA confirmation SMS, bank
 * statement line); the matching rail adapter parses it into structured
 * third-party evidence. On success the KPI check-in is logged with the
 * `third_party` rung and the rail's label in the evidence tags — the public
 * ledger then shows "3rd-party verified" backed by a real reference.
 *
 * Fail-soft: an unparseable artifact returns { ok: false } with a human
 * message; nothing is logged. No LLM in this path — deterministic parsing
 * only, so the trust rung is auditable.
 */
import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

import { rateLimiter } from "./rateLimit";
import { assertCanAct } from "./softAuth";
import { ensureRails, getRail, listRails } from "./rails";
import { syncInvestorsForVenture, syncVentureBrowse } from "./investorBriefing";

const railIdValidator = v.union(
    v.literal("mpesa"),
    v.literal("bank_ke"),
    v.literal("paystack"),
    v.literal("gcash"),
    v.literal("manual_statement")
);

export const verifyWithRail = mutation({
    args: {
        /** Which rail's parser to use. */
        rail: railIdValidator,
        /** Raw statement/confirmation text. */
        artifact: v.string(),
        /** The KPI value the founder is corroborating. */
        value: v.number(),
        note: v.optional(v.string()),
    },
    returns: v.union(
        v.object({
            ok: v.literal(true),
            message: v.string(),
            reference: v.string(),
            railLabel: v.string(),
        }),
        v.object({
            ok: v.literal(false),
            message: v.string(),
        })
    ),
    handler: async (ctx, args) => {
        await assertCanAct(ctx);
        const userId = await getAuthUserId(ctx);
        if (!userId) throw new Error("Sign in first.");
        if (!Number.isFinite(args.value) || args.value <= 0) {
            return { ok: false as const, message: "Enter a positive number first." };
        }
        await rateLimiter.limit(ctx, "investMutate", { key: "railVerify" });

        ensureRails();
        const rail = getRail(args.rail);
        if (!rail) return { ok: false as const, message: "Unknown payment rail." };

        const owner = await ctx.db
            .query("ventureOwners")
            .withIndex("by_userId", (q) => q.eq("userId", userId))
            .first();
        if (!owner) return { ok: false as const, message: "You don't run a venture yet." };
        const venture = await ctx.db.get(owner.ventureId);
        if (!venture) return { ok: false as const, message: "Venture not found." };

        const currency = venture.currency ?? "KES";
        if (!rail.currencies.includes(currency)) {
            return {
                ok: false as const,
                message: `${rail.label} does not operate in ${currency}.`,
            };
        }

        const evidence = await rail.verifyThirdParty({
            artifact: args.artifact,
            currency,
            expectedAmount: args.value,
        });
        if (!evidence) {
            return {
                ok: false as const,
                message: `Could not verify that ${rail.label} text against ${args.value.toLocaleString()} ${currency}. Check the reference and amount.`,
            };
        }

        const now = Date.now();
        await ctx.db.insert("kpiCheckIns", {
            ventureId: venture._id,
            commitmentId: null,
            periodLabel: `Verified · ${new Date(now).toISOString().slice(0, 10)}`,
            metric:
                venture.kpiUnit === "revenue_kes"
                    ? "revenue_kes"
                    : venture.kpiUnit === "jobs"
                      ? "jobs_completed"
                      : "meetings_booked",
            value: args.value,
            note: (args.note ?? `Verified via ${rail.label} ref ${evidence.reference}`).slice(0, 160),
            source: "self",
            verification: "third_party",
            createdAt: now,
        });

        await ctx.db.insert("ledgerEvents", {
            type: "checkin",
            ventureId: venture._id,
            commitmentId: null,
            ventureName: venture.name,
            ventureSlug: venture.publicSlug,
            summary: `${venture.name}: ${venture.kpiLabel.toLowerCase()} = ${args.value} — verified via ${rail.label} (ref ${evidence.reference})`,
            amountKes: null,
            currency,
            metric: venture.kpiLabel,
            value: args.value,
            evidence: ["self", "verified-third-party", rail.id],
            createdAt: now,
            publicVisible: true,
        });

        await syncInvestorsForVenture(ctx, venture._id);
        await syncVentureBrowse(ctx);

        return {
            ok: true as const,
            message: `Verified — ${rail.label} ref ${evidence.reference} matches ${args.value.toLocaleString()} ${currency}.`,
            reference: evidence.reference,
            railLabel: rail.label,
        };
    },
});

/** Which rails are available for the founder's venture (UI picker). */
export const availableRails = {
    list: listRails,
};
