# JuaKali — Invest in Public

Busy investors make soft **revenue-share** microcommitments into Kenya informal-sector (“Jua Kali”) apprentice ventures. An AI agent mentors the investee, logs hard KPIs, and publishes a transparent public ledger — Gemini on Google Cloud.

Built for the [Gemini X Prize](https://www.geminixprize.com/). Voice/SMS/USSD matching remains Lab scaffolding from the earlier Rapid Agent Hackathon prototype.

> Demo only: soft pledges — not securities, escrow, or live payments. Agent inbox inbound (`juakali@agentmail.to`) is live.

## How it works

1. Soft pledge into a venture (share of cashflow until a multiple cap).
2. Email ritual — in-app queue → approve, **or** email `juakali@agentmail.to` (AgentMail inbound, Svix-verified). Agent logs KPIs, digests, replies. Gmail for the human investor later.
3. Hard KPIs (meetings, revenue KES, jobs) with evidence tags.
4. Investor home + public ledger (“invest in public”).

Product UX, demo script, and decisions: [plans/invest-in-public-mvp.plan.md](plans/invest-in-public-mvp.plan.md).  
Product axes (identity × fidelity × teaching): [plans/product-axes.md](plans/product-axes.md).  
Historical matcher: [plans/jua-kali-apprenticeship-matcher.plan.md](plans/jua-kali-apprenticeship-matcher.plan.md).

## Architecture

```
Busy investor
   ├── Home (default)     scorecards · in-app / AgentMail ritual · digests
   ├── Ledger             capital → actions → results
   └── Lab                Agent · Funnel · Ops
        │
   Gemini + tools → Convex (ventures, commitments, KPIs, digests, ledger)
   In-app queue→approve · AgentMail `juakali@agentmail.to` → `/webhooks/agentmail` · Gmail later
```

## Structure

```
apps/default/                 Expo app — Home, Ledger, Lab
packages/backend/convex/      schema, invest.ts, telephony, http webhooks
packages/agent/               Gemini agent service
packages/mcp-server/          MCP tools
plans/                        Active + historical plans
```

## Getting started

```bash
bun install
cp .env.example .env
```

| Variable | Purpose |
|---|---|
| `GOOGLE_API_KEY` | Gemini ([AI Studio](https://aistudio.google.com/apikey)) |
| `CONVEX_DEPLOYMENT` / `EXPO_PUBLIC_CONVEX_*` | From `bunx convex dev` |
| `EXPO_PUBLIC_AGENT_URL` | Agent service (default `http://localhost:8080`) |
| `CONVEX_SITE_URL` | Backend for agent (default `http://localhost:3210`) |
| `EXPO_PUBLIC_PRODUCT_PRESET` | `demo` (loud teaching; Netlify default) or `app` (quieter returning-investor) |
| `EXPO_PUBLIC_REQUIRE_AUTH_TO_ACT` | UI hint; pair with Convex `REQUIRE_AUTH_TO_ACT=1` to enforce |

Convex soft identity: `AUTH_RESEND_KEY`, `SOFT_AUTH_INBOX=1`, `REQUIRE_AUTH_TO_ACT=1`.  
AgentMail (Convex secrets): `AGENTMAIL_API_KEY`, `AGENTMAIL_WEBHOOK_SECRET` — inbox `juakali@agentmail.to` → `…/webhooks/agentmail`.

```bash
# Or: bun run dev
cd packages/backend && bun run dev   # Terminal 1
cd packages/agent && bun run dev     # Terminal 2
cd apps/default && bun run start     # Terminal 3
```

Open **Home** → **Seed** for sample pledges, KPIs, email, and ledger events.

## Deploy (investor review)

- **Frontend (Expo web):** Netlify builds from `main` via [`netlify.toml`](netlify.toml) (`bun run export:web` → `apps/default/dist`).
- **Backend:** Convex prod (`zealous-scorpion-285`) — not Google Cloud. Agent (Lab chat) → Cloud Run later.
- **Demo UX:** Preset `demo` — first visit = landing → Home; new session = Welcome back. Lab only with `?lab=1`. Reset: Help → Show intro again, or `?fresh=1`. Force demo teaching: `?demo=1`.
- **Modes:** Same IA always; compose identity × fidelity × teaching — see [plans/product-axes.md](plans/product-axes.md).
- Details: [plans/invest-in-public-mvp.plan.md](plans/invest-in-public-mvp.plan.md).

## Deploy agent (Cloud Run)

```bash
cd packages/agent
gcloud builds submit --tag gcr.io/YOUR_PROJECT/juakali-agent
gcloud run deploy juakali-agent \
  --image gcr.io/YOUR_PROJECT/juakali-agent \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars "GOOGLE_API_KEY=your-key,CONVEX_SITE_URL=https://your-deployment.convex.site"
```

## MCP server

```bash
cd packages/mcp-server && bun run dev
```

Point your MCP client at that package with `JUAKALI_BACKEND_URL` set to your Convex site URL.

## Stack

Gemini 2.5 Flash · Cloud Run · MCP · Convex · Expo · AgentMail (`juakali@agentmail.to`) · Twilio / Africa’s Talking (funnel)

Pre-commit (Husky): gitleaks on staged changes + ESLint via lint-staged (`apps/default`, `packages/backend`). Requires [`gitleaks`](https://github.com/gitleaks/gitleaks#installing) on your PATH.
## Shipaton 2026 readiness

JuaKali targets [RevenueCat's Shipaton 2026](https://shipaton.com/) (global mobile
hackathon, Aug–Sep 2026) — strong fit for the **Peace Prize**, **#BuildInPublic**, and
**Design** awards. Two gaps must close before entry: a real **store binary** (native iOS +
Android via EAS) and **monetization** (RevenueCat subscription for Investor/Pro).

- Full assessment, gaps, and step-by-step path: [`plans/shipaton-2026-readiness.md`](plans/shipaton-2026-readiness.md).
- **Native build setup:** EAS config in `apps/default/eas.json`; bundle/package ids in `apps/default/app.json`.
- **Monetization:** RevenueCat tier + entitlement `subscriptions` table, `getMyEntitlements`,
  `/webhooks/revenuecat` (Bearer-secret signed), `paywall.tsx` — all scaffolded. Runtime
  `Purchases.configure({ apiKey })` (no config plugin needed; web untouched).

Short version of the recommended order:
1. EAS build → TestFlight / Play (store presence is the hard requirement).
2. RevenueCat **Investor** tier (monthly) → HAMM + real revenue traction.
3. If a submitter is a student, run the **Next Gen** track (video + source) in parallel.
