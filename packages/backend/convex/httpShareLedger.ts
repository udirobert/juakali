/**
 * GET /share/ledger?slug=<venture-public-slug>
 *
 * Tiny static HTML shell with per-deal Open Graph meta. Netlify proxies
 * /deal/<slug> here (see netlify.toml), so:
 * - crawlers capture og:* tags (they don't follow the meta refresh);
 * - humans land in the SPA instantly via the meta refresh.
 *
 * Lives on Convex (not a Netlify edge function) because the data is already
 * here, it deploys atomically with the schema, and it's a deterministic
 * serverless function instead of edge runtime.
 */
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import { env } from "./env";

// Same source of truth as Convex Auth redirects (env.SITE_URL); the constant
// is only the fallback for the brief pre-provisioning window.
const SITE_URL = (env.SITE_URL ?? "https://juakaliapp.netlify.app").replace(/\/$/, "");
const OG_IMAGE = `${SITE_URL}/og.jpg`;
const CACHE_CONTROL = "public, max-age=300, s-maxage=600";

export default async function shareLedger(ctx: ActionCtx, request: Request): Promise<Response> {
    const url = new URL(request.url);
    // Netlify query-forwarding preserves the original param name ("ledger").
    const slug = ((url.searchParams.get("ledger") ?? url.searchParams.get("slug")) ?? "")
        .trim()
        .toLowerCase();

    if (!slug) {
        return shell({
            title: "JuaKali · Invest in Public",
            description:
                "Read-only public proof — capital pledges, KPI check-ins, and agent digests for informal-sector ventures. Proof over promises.",
            pageUrl: SITE_URL,
        });
    }

    try {
        const ledger = await ctx.runQuery(internal.dealShare.getShareData, { slug });
        if (ledger) {
            const pledged = `KES ${ledger.pledgedKes.toLocaleString("en-KE")}`;
            return shell({
                title: `${ledger.ventureName} — JuaKali public ledger`,
                description: `${pledged} soft-pledged · ${ledger.checkIns} KPI check-ins · ${ledger.digests} agent digests. Follow the deal live — Invest in Public.`,
                pageUrl: `${SITE_URL}/deal/${encodeURIComponent(slug)}`,
                appUrl: `${SITE_URL}/?ledger=${encodeURIComponent(slug)}`,
            });
        }
    } catch (err) {
        console.error("[dealShare] lookup failed", err);
    }

    return shell({
        title: "JuaKali · Invest in Public",
        description:
            "Read-only public proof — capital pledges, KPI check-ins, and agent digests for informal-sector ventures. Proof over promises.",
        pageUrl: `${SITE_URL}/deal/${encodeURIComponent(slug)}`,
        appUrl: `${SITE_URL}/?ledger=${encodeURIComponent(slug)}`,
    });
}

function shell(args: {
    title: string;
    description: string;
    pageUrl: string;
    /** Where humans go immediately (meta refresh into the SPA). */
    appUrl?: string;
}): Response {
    const title = escapeHtml(args.title);
    const description = escapeHtml(args.description);
    const pageUrl = args.pageUrl;
    const refresh = args.appUrl
        ? `<meta http-equiv="refresh" content="0; url=${args.appUrl}">`
        : "";
    const html = [
        "<!doctype html>",
        `<html lang="en"><head><meta charset="utf-8">`,
        `<meta name="viewport" content="width=device-width, initial-scale=1">`,
        `<title>${title}</title>`,
        `<meta name="description" content="${description}">`,
        refresh,
        `<meta name="robots" content="index,follow">`,
        `<link rel="canonical" href="${pageUrl}">`,
        `<meta property="og:site_name" content="JuaKali">`,
        `<meta property="og:type" content="website">`,
        `<meta property="og:url" content="${pageUrl}">`,
        `<meta property="og:title" content="${title}">`,
        `<meta property="og:description" content="${description}">`,
        `<meta property="og:image" content="${OG_IMAGE}">`,
        `<meta property="og:image:alt" content="${title}">`,
        `<meta name="twitter:card" content="summary_large_image">`,
        `<meta name="twitter:title" content="${title}">`,
        `<meta name="twitter:description" content="${description}">`,
        `<meta name="twitter:image" content="${OG_IMAGE}">`,
        `</head>`,
        `<body style="background:#E6E4DF;font-family:Georgia,serif;padding:32px;color:#141816">`,
        `<h1 style="font-size:24px;margin:0 0 8px">${title}</h1>`,
        `<p style="font-size:15px;line-height:1.5;color:#5E6660;max-width:560px">${description}</p>`,
        `<p><a href="${pageUrl}" style="color:#7C5E22;font-weight:bold">Open the live ledger →</a></p>`,
        `</body></html>`,
    ].join("\n");

    return new Response(html, {
        status: 200,
        headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": CACHE_CONTROL,
        },
    });
}

function escapeHtml(value: string) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
