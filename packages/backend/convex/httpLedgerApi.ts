/**
 * GET /api/ledger — public JSON API for the JuaKali ledger.
 * GET /api/ledger?slug=<venture-slug> — scoped to one deal.
 *
 * "Invest in public" only matters if the public can consume the ledger:
 * journalists, NGOs, accelerators, and researchers get a stable, read-only,
 * unauthenticated JSON feed of the same rows the UI renders. No private
 * data ever leaves here: only publicVisible events, aggregate totals, and
 * venture metadata that is already denormalized onto public rows.
 *
 * Throttled per client IP (same bucket family as the share route).
 * CORS: open read (`*`) — this is the point of a public API.
 *
 * Shape (versioned envelope so consumers can pin):
 * {
 *   "version": 1,
 *   "totals": { "pledgedKes", "currency", "checkIns", "activeVentures", "digests" },
 *   "ventures": [{ "id", "name", "slug" }],
 *   "events": [{ "id", "type", "summary", "amountKes", "currency", "metric",
 *                "value", "evidence", "ventureName", "ventureSlug",
 *                "createdAt", "correlationId", "runId", "initiator" }]
 * }
 */
import type { ActionCtx } from "./_generated/server";
import { api } from "./_generated/api";
import { rateLimiter } from "./rateLimit";

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body, null, 2), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=30, s-maxage=120",
        },
    });

export default async function ledgerApi(ctx: ActionCtx, request: Request): Promise<Response> {
    // Preflight for browser consumers.
    if (request.method === "OPTIONS") {
        return new Response(null, {
            status: 204,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
            },
        });
    }
    if (request.method !== "GET") {
        return json({ ok: false, error: "Method not allowed" }, 405);
    }

    // Per-IP throttle — same posture as the share route (public, unauthenticated).
    const ip =
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        request.headers.get("x-nf-client-connection-ip") ||
        "unknown";
    await rateLimiter.limit(ctx as Parameters<typeof rateLimiter.limit>[0], "publicShare", {
        key: ip,
        throws: false,
    });

    const url = new URL(request.url);
    const slugParam = url.searchParams.get("slug")?.trim().toLowerCase() || null;
    const limitParam = Number(url.searchParams.get("limit") ?? 40);
    const limit = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : 40, 1), 100);

    const ledger = (await ctx.runQuery(api.invest.publicLedger, { limit, ventureSlug: slugParam ?? undefined })) as {
        events: Array<Record<string, unknown>>;
        ventures: Array<Record<string, unknown>>;
        totals: Record<string, unknown>;
    } | null;
    if (!ledger) return json({ ok: false, error: "Ledger unavailable" }, 503);

    return json({
        version: 1,
        license: "CC BY 4.0 — attribute JuaKali (juakali.app). Soft pledges are intent, not settlement.",
        generatedAt: new Date().toISOString(),
        filter: slugParam ?? null,
        totals: ledger.totals,
        ventures: ledger.ventures,
        events: ledger.events,
    });
}
