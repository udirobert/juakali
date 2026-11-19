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

## BCH settlement layer (BCH Blaze 2026)

Two layers, per-field ownership — the chain is a settlement + proof layer, not a database. Convex stays the system of record.

- **Chain owns**: settlement status (a commitment is `funded` only when its tx confirms — Convex caches the txid, never claims settlement), the venture's BCH↔Nostr identity binding proof, covenant state.
- **Convex owns**: everything else — KPI detail, notes, photos, emails, agent runs, digests, corrections and disputes. Chain entries can't be edited; `correctionOf`/`disputeState` absorb real-world amendments off-chain.
- **Nostr carries**: signed attestations and identity announcements — portable reputation that survives juakali-the-company. Third-party-verified KPI check-ins publish as signed events on the venture's npub.
- **Anchors are one-way**: the chain commits to the off-chain record (hashes only, never private content); the record never waits on the chain.

On-chain settlement is an **upgrade path per commitment**, not a product migration: a pledge starts soft, upgrades when both parties have wallets, and the fidelity badge flips `soft → live` on that deal only. Adoption gradient: soft → assisted (sponsored venture address, Paytaca onboarding) → self-custody.

Investor side is `lib/bch/` + `@wizardconnect/react` in `apps/default` — the dapp constructs the PUSD/BCH send to the venture's `bchAddress`, the wallet (Paytaca/Selene; Cashonize on chipnet for dev) signs, the app broadcasts and records the txid via `recordPledgeFunding`; `ledgerEvents.onchainRef` renders the proof. XO covenant templates (Migrate to XO bounty) carry the tranche-release lifecycle. Full plan: [plans/bch-blaze-2026.plan.md](../plans/bch-blaze-2026.plan.md).

Implementation notes (first slice):

- `lib/bch/` — `network.ts` (electrum provider via mainnet-js `getNetworkProvider`, explorer URLs), `address.ts` (cashaddr ⇄ locking bytecode via libauth), `tx.ts` (UTXO selection + unsigned libauth `Transaction` + `sourceOutputs`/`inputPaths` for the hdwalletv1 sign request; CashToken-aware — token-category input selection, `token` on recipient/change outputs, excess-token change, foreign-token UTXOs never spent; gated by `EXPO_PUBLIC_BCH_PLEDGE_TOKEN`), `use-bch-wallet.ts` hook (WizardConnect session → 20-address gap-limit scan including token UTXOs → sign → broadcast).
- Backend: `setVentureSettlement`, `recordPledgeFunding`, `recordRepayment` mutations; `ledgerEvents.txid`/`onchainRef`; commitments carry `settlementAsset`/`settlementNetwork`/`pledgeTxid`/`repaidTotal` — all additive-optional, legacy rows validate.
- **Metro shim**: `@bitauth/libauth`'s `crypto/default-crypto-instances.js` uses top-level await to instantiate WASM — Metro can't parse it, and Hermes has no `WebAssembly` at all. `metro.config.js` `resolveRequest` redirects that one module to `lib/bch/libauth-crypto-shim.ts`, which lazy-inits behind `ensureBchCrypto()` (called before wallet connect). On-chain funding is therefore **web-only** for this slice; native shows the card only if a WASM-free path lands later.
- `EXPO_PUBLIC_BCH_NETWORK` selects `chipnet` (default) or `mainnet`. Chipnet tx proof renders on `blockexplorer.cash/chipnet`.
- **Ledger-print UI layer**: `lib/print/halftone.ts` (ordered-dither core) + `LedgerPrintImage` (web canvas / native photo fallback) render field imagery as newspaper plates; `VerifyLens` on the proof screen masks away presentation to expose raw record fields (hold-to-inspect); `ScrollReveal` (IntersectionObserver) reveals ledger rows on scroll; `lib/motion/flip.ts` (WAAPI FLIP, no deps) morphs deal chips into the detail stack; `SettlementRail` + `OnchainSeal` make the pledge→funded→repaid journey and txids legible.

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
