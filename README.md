# JuaKali — Invest in Public

Busy investors make soft **revenue-share** microcommitments into Kenya informal-sector (“Jua Kali”) apprentice ventures. An AI agent mentors the investee, logs hard KPIs, and publishes a transparent public ledger — Gemini on Google Cloud.

Built for the [Gemini X Prize](https://www.geminixprize.com/). Voice/SMS/USSD matching remains Lab scaffolding from the earlier Rapid Agent Hackathon prototype.

> Demo only: soft pledges — not securities, escrow, or live payments.

## How it works

1. Soft pledge into a venture (share of cashflow until a multiple cap).
2. Email ritual — queue → approve → agent logs KPIs, digests, replies. Agent-native inbox ([AgentMail](https://docs.agentmail.to/welcome)); Gmail later.
3. Hard KPIs (meetings, revenue KES, jobs) with evidence tags.
4. Investor home + public ledger (“invest in public”).

Product UX, demo script, and decisions: [plans/invest-in-public-mvp.plan.md](plans/invest-in-public-mvp.plan.md). Historical matcher: [plans/jua-kali-apprenticeship-matcher.plan.md](plans/jua-kali-apprenticeship-matcher.plan.md).

## Architecture

```
Busy investor
   ├── Home (default)     scorecards · email ritual · digest artifacts
   ├── Ledger             capital → actions → results
   └── Lab                Agent · Funnel · Ops
        │
   Gemini + tools → Convex (ventures, commitments, KPIs, digests, ledger)
   In-app email today · AgentMail webhook `/webhooks/agentmail` · Gmail later
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

Gemini 2.5 Flash · Cloud Run · MCP · Convex · Expo · AgentMail webhook scaffold · Twilio / Africa’s Talking (funnel)

Pre-commit (Husky): gitleaks on staged changes + ESLint via lint-staged (`apps/default`, `packages/backend`). Requires [`gitleaks`](https://github.com/gitleaks/gitleaks#installing) on your PATH.
