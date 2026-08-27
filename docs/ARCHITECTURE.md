# Architecture — Gemini X Prize submission

Single-page summary for judges. **Updated during the X Prize build window (Aug 2026).**

## North-star

```
Busy investor
   ├── Home (default)     scorecards · in-app / AgentMail ritual · digests
   ├── Ledger             capital → actions → results
   └── Lab                Agent · Funnel · Ops
        │
   Gemini + tools → Convex (ventures, commitments, KPIs, digests, ledger)
   In-app queue→approve · AgentMail `juakali@agentmail.to` → `/webhooks/agentmail` · Gmail later
```

## What is AI and what is not

- **AI / Gemini-grounded:**
  - `/chat` endpoint (Cloud Run). Uses `gemini-3.6-flash` as the LLM with structured function-calling against the policy in `SYSTEM_PROMPT`.
  - Mentorship ask parsing: voice transcripts → structured master profile (gemini voice-intake path).
  - Shared mentor content → actionable founder advice (article/podcast parsing).
- **Deterministic, no LLM:**
  - The Convex ledger and digest tables, every read/write path.
  - Trust boundaries (`authorization`: investor ↔ commitment ↔ run).
  - Approval gate before consequential writes are published.
  - KPI roll-ups for cockpit, briefing, and venture browse indexes.

## Components (hosting in parentheses)

- `apps/default` — Expo. Deployed as **web** via Netlify, configured for native via EAS in production.
- `packages/backend/convex` — Convex (prod deployment name `zealous-scorpion-285`). Schema-first, durable `agentRuns`, monthly digest cadence, public ledger endpoint, Svix-verified AgentMail webhook.
- `packages/agent` — Gemini + tool executor. **Deployed to Cloud Run** as `juakali-agent` (region `us-central1`, cognivern project).
- `packages/mcp-server` — MCP server exposing the same Convex tools over the Model Context Protocol.

## What "live in production" looked like during the build window

- Cloud Run service: **publicly URL-reachable**, version-revisioned, logs visible in GCP console.
- Convex prod database: **shared by the Expo app and the Cloud Run agent**. Every `/chat` request reads/writes from the same `agentRuns`, `agentDigests`, `ledgerEvents` tables the Expo app streams.
- AgentMail inbound: verified by Svix. **The same pipeline executes** whether the note arrives via the in-app queue or via email to `juakali@agentmail.to`.

## What the AI does — the operating loop

1. **Initiative.** Hourly cron creates a `proposed` `agentRun` per commitment whenever the venture's latest KPI is stale (>24h). The card says what Jua *wants* to do, with a consequence list. **Approve → pipeline runs; dismiss → run marked dismissed, no re-proposal inside the staleness window.** Nothing runs without approval.
2. **Two-step consent.** When investor-entered evidence is too thin, founder evidence is recorded on the run but the public-facing digest/ledger steps stay parked in `awaiting_publication` until the investor approves the exact public summary.
3. **Durable steps.** Each run has steps `record_kpi → create_investor_digest → post_public_ledger → send_reply`. Each step commits in its own Convex transaction. The cockpit streams real step state via subscriptions.
4. **Truthful agent runs.** No simulated chips, no artificial delays. A cron fails runs stuck >90s. Truthful evidence tags (`email`, `agent`, `sms`, `whatsapp` + `agent`).

## What the human does (and what the human doesn't)

- **The founder runs the venture.** They post updates (situation/problem/opportunity/win) and self-report KPIs. Jua reads those, but never operates the business.
- **The investor decides.** Approves proposals, approves emails/note replies, sets autonomy level (`ask_every_time` default → `proactive_only` → `pause_all`).
- **Jua mentors, monitors, and makes it visible.** Posts digests, surfaces stale-KPI proposals, replies in natural language, posts to the public ledger.

## Off-limits surface (judges, please note)

- **Soft pledges.** "Pledged KES X" is **intent**, not escrow. The README, in-app badges, and seed copy never imply settlement, securities, or live payment. The product is at the prototype stage; capital is being modeled but not transferred.
- **Pre-revenue.** No paying customers at submission time. The Traction criterion is honest-failed: we have a working operating loop, not a revenue track record. Category award criteria were prioritized.
