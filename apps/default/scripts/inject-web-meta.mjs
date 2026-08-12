#!/usr/bin/env node
/**
 * Inject SEO / social meta into Expo web SPA index.html after export.
 * Expo already emits a short title/description/theme-color from app.json —
 * we replace those with the product-aligned set.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SITE_URL = "https://juakaliapp.netlify.app";
const TITLE = "JuaKali · Invest in public";
const DESCRIPTION =
    "Soft-pledge into apprentice ventures. An agent drives weekly KPIs, digests, and a public ledger — non-securities, non-settling commitments.";
const OG_IMAGE = `${SITE_URL}/og.jpg`;
const OG_ALT = "JuaKali — Invest in public. Soft pledges, agent ops, public ledger.";

const distIndex = path.join(__dirname, "..", "dist", "index.html");

if (!fs.existsSync(distIndex)) {
    console.error(`inject-web-meta: missing ${distIndex}`);
    process.exit(1);
}

let html = fs.readFileSync(distIndex, "utf8");

if (html.includes('property="og:title"')) {
    console.log("inject-web-meta: tags already present, skipping");
    process.exit(0);
}

// Drop Expo defaults we’ll re-emit
html = html.replace(/<title>[^<]*<\/title>/gi, "");
html = html.replace(/<meta\s+name="description"[^>]*>/gi, "");
html = html.replace(/<meta\s+name="theme-color"[^>]*>/gi, "");

const headExtras = `
    <title>${TITLE}</title>
    <meta name="description" content="${DESCRIPTION}" />
    <meta name="application-name" content="JuaKali" />
    <meta name="theme-color" content="#E6E4DF" />
    <meta name="color-scheme" content="light" />
    <meta name="robots" content="index,follow,max-image-preview:large" />
    <link rel="canonical" href="${SITE_URL}/" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="JuaKali" />
    <meta property="og:locale" content="en_KE" />
    <meta property="og:url" content="${SITE_URL}/" />
    <meta property="og:title" content="${TITLE}" />
    <meta property="og:description" content="${DESCRIPTION}" />
    <meta property="og:image" content="${OG_IMAGE}" />
    <meta property="og:image:alt" content="${OG_ALT}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${TITLE}" />
    <meta name="twitter:description" content="${DESCRIPTION}" />
    <meta name="twitter:image" content="${OG_IMAGE}" />
    <meta name="twitter:image:alt" content="${OG_ALT}" />
    <link rel="manifest" href="/site.webmanifest" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
`;

if (!html.includes("</head>")) {
    console.error("inject-web-meta: no </head> in index.html");
    process.exit(1);
}
html = html.replace("</head>", `${headExtras}</head>`);
fs.writeFileSync(distIndex, html);
console.log("inject-web-meta: wrote SEO tags into dist/index.html");
