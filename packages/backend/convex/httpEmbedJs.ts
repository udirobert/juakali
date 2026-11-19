/**
 * GET /embed.js — embeddable deal widget loader.
 *
 * Partners (accelerators, NGOs, newsrooms) drop one line into any page:
 *
 *   <div data-juakali-deal="venture-slug"></div>
 *   <script src="https://juakaliapp.netlify.app/embed.js" async></script>
 *
 * (or per-deal: <script src=".../embed.js?deal=<slug>" data-deal="<slug>">)
 *
 * The loader fetches the public JSON ledger API and renders a small,
 * self-contained, brand-styled card: venture name, pledged total, KPI
 * check-ins, digests, and a link to the full public ledger. No build step,
 * no dependencies, shadow-DOM-free (simple class-scoped styles), CSP-friendly
 * (one GET to the API origin). Attribution is baked in — the widget IS the
 * citation.
 */
import type { ActionCtx } from "./_generated/server";

const SITE_URL = "https://juakaliapp.netlify.app";
const API_URL = "https://zealous-scorpion-285.convex.site/api/ledger";

export default async function embedJs(_ctx: ActionCtx, request: Request): Promise<Response> {
    const url = new URL(request.url);
    const defaultDeal = url.searchParams.get("deal")?.trim() || "";

    const js = `(function () {
  var API = ${JSON.stringify(API_URL)};
  var SITE = ${JSON.stringify(SITE_URL)};
  var DEFAULT_DEAL = ${JSON.stringify(defaultDeal)};
  var CSS = [
    ".juakali-embed{font:14px/1.45 -apple-system,'Segoe UI',Roboto,sans-serif;color:#1a1f1d;",
    "background:#f6f3ec;border:1px solid #d8d0bd;border-radius:10px;padding:14px 16px;max-width:420px;",
    "margin:8px 0}",
    ".juakali-embed .jk-sun{font-size:16px}",
    ".juakali-embed .jk-name{font-weight:700;font-size:15px;margin:2px 0 4px}",
    ".juakali-embed .jk-total{font-size:22px;font-weight:800;letter-spacing:-0.3px}",
    ".juakali-embed .jk-meta{color:#6b6a5f;font-size:12px;margin-top:2px}",
    ".juakali-embed .jk-badge{display:inline-block;font-size:9px;font-weight:700;letter-spacing:.5px;",
    "text-transform:uppercase;color:#8a6d1f;background:#f3e8c8;border:1px solid #e2d3a0;",
    "border-radius:4px;padding:2px 6px;margin-top:8px}",
    ".juakali-embed a{color:#8a6d1f;font-weight:700;text-decoration:none}",
    ".juakali-embed .jk-err{color:#8a3b1f;font-size:12px}"
  ].join("");

  function render(el, data) {
    var t = data.totals || {};
    var cur = t.currency || "KES";
    var sym = { KES:"KSh", USD:"$", NGN:"\\u20a6", GHS:"\\u20b5", PHP:"\\u20b1", IDR:"Rp", INR:"\\u20b9", BRL:"R$", ZAR:"R" }[cur] || cur;
    var ev = data.events || [];
    var last = ev[0];
    el.innerHTML =
      '<div class="juakali-embed">' +
      '<div class="jk-sun">\\u2600</div>' +
      '<div class="jk-name">' + esc(last && last.ventureName || "JuaKali venture") + '</div>' +
      '<div class="jk-total">' + sym + ' ' + Number(t.pledgedKes || 0).toLocaleString() + '</div>' +
      '<div class="jk-meta">' + (t.activeVentures || 0) + ' active ventures \\u00b7 ' + (t.checkIns || 0) + ' KPI check-ins \\u00b7 ' + (t.digests || 0) + ' digests</div>' +
      (last ? '<div class="jk-meta">Latest: ' + esc(String(last.summary).slice(0, 90)) + '</div>' : "") +
      '<span class="jk-badge">Soft \\u00b7 intent, not escrow</span><br>' +
      '<a href="' + SITE + '/?ledger=' + encodeURIComponent(data.filter || "") + '" target="_blank" rel="noopener">View public ledger \\u2192</a>' +
      '</div>';
  }
  function esc(s) { var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

  function load(el) {
    var slug = el.getAttribute("data-juakali-deal") || DEFAULT_DEAL;
    fetch(API + (slug ? "?slug=" + encodeURIComponent(slug) : ""), { headers: { Accept: "application/json" } })
      .then(function (r) { return r.json(); })
      .then(function (data) { render(el, data); })
      .catch(function () { el.innerHTML = '<div class="juakali-embed"><span class="jk-err">Ledger temporarily unavailable.</span></div>'; });
  }

  var style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  function scan() {
    var nodes = document.querySelectorAll("[data-juakali-deal]");
    for (var i = 0; i < nodes.length; i++) load(nodes[i]);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan);
  else scan();
})();`;

    return new Response(js, {
        status: 200,
        headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "public, max-age=300, s-maxage=600",
            "Access-Control-Allow-Origin": "*",
        },
    });
}
