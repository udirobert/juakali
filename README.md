# JuaKali — Invest in Public

Busy investors make soft **revenue-share** microcommitments into Kenya informal-sector (“Jua Kali”) apprentice ventures. An AI agent mentors the investee, logs hard KPIs, and publishes a transparent public ledger — Gemini on Google Cloud.

Built for the [Gemini X Prize](https://www.geminixprize.com/). See [docs/xprize-submission.md](docs/xprize-submission.md) for the submission-facing summary and [docs/ops.md](docs/ops.md) for the internal ops/cleanup checklist. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains the loop, what is AI and what isn't.

Entering [BCH Blaze 2026](https://dorahacks.io/hackathon/bchblaze2026): soft pledges become real **PUSD/BCH micro-commitments** on Bitcoin Cash — WizardConnect wallet funding, on-chain settlement proofs on the public ledger, and a venture identity bound BCH↔Nostr. Plan and bounty map: [plans/bch-blaze-2026.plan.md](plans/bch-blaze-2026.plan.md).

Scoped for the [Tari Ootle November "MVP!" contest](https://community.tari.com/t/520) (due Dec 1 UTC): a `RevenueShareCommitment` template — confidential XTM pledge vaults whose repayments auto-split `shareBps` to the investor until `capMultiple`. Plan: [plans/tari-ootle-mvp.plan.md](plans/tari-ootle-mvp.plan.md).

Voice/SMS/USSD matching remains Lab scaffolding from the earlier Rapid Agent Hackathon prototype.

> Capital: soft pledges by default — **not securities, escrow, or investment contracts**. On-chain pledge funding (PUSD/BCH) is an opt-in per-commitment settlement mode landing for BCH Blaze; a commitment shows `live` fidelity only once its funding tx is confirmed on-chain. Agent inbox inbound (`juakali@agentmail.to`) is live. The Gemini agent is publicly deployed to Google Cloud Run (see submission summary for URL + model).

## How it works

1. Pledge into a venture (share of cashflow until a multiple cap) — soft intent by default, or fund it for real in PUSD/BCH via a WizardConnect wallet.
2. Email ritual — in-app queue → approve, **or** email `juakali@agentmail.to` (AgentMail inbound, Svix-verified). Agent logs KPIs, digests, replies. Gmail for the human investor later.
3. Hard KPIs (meetings, revenue KES, jobs) with evidence tags — third-party-verified check-ins publish as signed Nostr attestations on the venture's portable identity.
4. Investor home + public ledger (“invest in public”) — funded pledges carry txid links so anyone can verify the capital leg on-chain.

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

Gemini 2.5 Flash · Cloud Run · MCP · Convex · Expo · AgentMail (`juakali@agentmail.to`) · Twilio / Africa’s Talking (funnel) · Bitcoin Cash settlement layer (WizardConnect · CashTokens/PUSD · Nostr identity)

Pre-commit (Husky): gitleaks on staged changes + ESLint via lint-staged (`apps/default`, `packages/backend`). Requires [`gitleaks`](https://github.com/gitleaks/gitleaks#installing) on your PATH.

## Contest history

- **Gemini X Prize** (Aug 2026) — primary submission. See [docs/xprize-submission.md](docs/xprize-submission.md).
- **BCH Blaze 2026** — settlement layer; submissions close **Nov 22, 14:00 UTC**. See [plans/bch-blaze-2026.plan.md](plans/bch-blaze-2026.plan.md).
- **Tari Ootle "MVP!"** — `RevenueShareCommitment` template in a separate MIT repo; closes **Dec 1, 00:00 UTC**. Runs *after* the Blaze submission — the two contests do not conflict (different repos, different chains). See [plans/tari-ootle-mvp.plan.md](plans/tari-ootle-mvp.plan.md).
- **RevenueCat Shipaton 2026** — **closed Aug–Sep 2026 with no entry submitted.** The native/EAS + RevenueCat scaffolding it motivated (EAS config, `subscriptions` table, `getMyEntitlements`, `/webhooks/revenuecat`, `paywall.tsx`) is still in the repo but **dormant** — nothing is wired to a live store binary or a real RevenueCat project. Kept as the starting point if we ever ship to stores; [`plans/shipaton-2026-readiness.md`](plans/shipaton-2026-readiness.md) is now a reference doc, not an active plan.
