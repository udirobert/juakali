# Phase 1 — Harden: ops checklist

From the level-up plan (Nov 2026). Items marked **[manual]** need an account owner
(they involve billing or external dashboards); everything else is code-side.

## Phase 2 progress (founder surface) — code-side, shipped 2026-11-18

- [x] **Evidence honesty, not a ladder** — `kpiCheckIns.verification`,
      `founderEvidence.verification`, and `agentRuns.pipeline.verification`
      always persist `self_reported`; claimed documents ride a separate
      `claimedDoc` field (`photo` / `receipt`). Founder mutations accept the
      caller's claim but the backend never stores a verified rung.
- [x] **Trust gradient on the ledger** — `evidenceTags` surfaces the claim
      honestly (`photo-mentioned`, `receipt-mentioned`,
      `statement-text-matched` for payment artifacts that line up); no tag
      claims independent verification. The ledger UI renders them as a
      distinct chip treatment with human labels.
- [x] **Founder check-in UI** — the venture cockpit check-in shows an
      evidence-ladder picker when a KPI number is entered (my own count /
      I have a photo / statement or receipt), wired to both mutations.
- [x] **Investor portfolio roll-up** — `api.invest.portfolio` (authenticated,
      fail-closed): soft pledge total, per-deal status, KPI staleness, pending
      decisions/publication. `PortfolioStrip` renders on Home when the
      investor holds >1 deal: tappable per-deal chips (up to date / proposal
      waiting) with stale deals flagged; cap progress shows an estimate only
      for KES pledges with sufficient post-pledge reported KES revenue —
      a reported zero is not missing data, and recorded repayments print
      separately as recorded, not confirmed.
- [x] **Impact stat on the public ledger** — jobs-created from
      `api.invest.impactTotals` shows on the unfiltered ledger hero.
- [x] **Voice-first KPI capture** — `POST /voice/kpi-checkin` (bearer-gated
      via `VOICE_KPI_TOKEN`, per-IP throttled): Gemini transcription
      (Swahili/English/mixed) + number parsing (digits and Swahili/English
      number words). Client `useVoiceKpi` hook records, transcribes, and
      shows "I heard: … — correct?" — nothing logs until the founder
      confirms. Cockpit has a speak-your-number button beside the KPI input.
- [x] **Offline check-in queue** — `useFounderQueue`: durable local queue
      (SecureStore/localStorage), flushes on mount and connectivity regain;
      offline sends save locally with "Saved on this phone — will send when
      the network returns"; network failures re-queue, validation failures
      surface for review with retry; queue card shows per-item state.
- [ ] M-PESA statement parser — today a pasted statement can only
      `statement-text-match` a **KES revenue** check-in; a real parser +
      provider could lift it further (still evidence, not verification).
- [ ] Android EAS build (needs Expo account + credentials).
- [ ] Native (expo-av) recording for voice KPI on Android — the web
      MediaRecorder path works today; native falls back to keyboard.
- [ ] Weekly digest email (Resend) — needs the production Resend key first.
- [ ] Ledger public JSON API + embeddable widget.

## Done in code (this phase)

- [x] **CI** — `.github/workflows/ci.yml`: typecheck + lint + test + lockfile
      verify on every PR, with Convex codegen. Requires one repo secret:
      `CONVEX_PREVIEW_DEPLOYMENT` (a dev deployment id, e.g. `dev:xxx-yyy`).
- [x] **Dead-letter queue for agent runs** — new `dead_letter` run status;
      `sweepDeadLetters` cron (every 15 min) parks runs that failed 3+ retries;
      `retryFailedRun` accepts dead-lettered runs and resets the counter;
      failed/dead-lettered runs still surface in the investor activity feed.
- [x] **Public share route throttled** — `/share/ledger` rate-limited per client
      IP (120/min, non-throwing) via the existing rate-limiter component.
- [x] **Backup script** — `scripts/backup-convex.sh` (Convex export + 30-snapshot
      retention). Schedule it (cron / GitHub Actions) and copy snapshots to
      durable storage.
- [x] **Staging env recipe** — documented in `.env.example`.

## Manual steps (owner required)

- [ ] **[manual] CI secret** — add `CONVEX_PREVIEW_DEPLOYMENT` to GitHub repo
      secrets (use a *dev* deployment, not prod).
- [ ] **[manual] Staging deployment** — create it:
      `cd packages/backend && npx convex deployment create --name staging`,
      then wire a Netlify branch deploy per `.env.example`.
- [ ] **[manual] Prod hardening flip** — on the prod deployment:
      ```bash
      cd packages/backend && npx convex env set REQUIRE_AUTH_TO_ACT 1 --prod
      ```
      This enforces sign-in for pledge / approve / seed / startCommitment.
      Highest-leverage single trust upgrade; the code path already exists
      (`softAuth.ts` → `assertCanAct`). Do it after staging verifies the flow.
- [ ] **[manual] Production Resend** — set `AUTH_RESEND_KEY` (prod Resend key)
      on the prod deployment, then unset `SOFT_AUTH_INBOX` (kills the demo
      magic-link peek).
- [ ] **[manual] Paid Gemini key** — the free AI Studio key caps at 5 req/min
      (see docs/xprize-submission.md). Upgrade the key or move to Vertex AI
      billing, then set it on the Cloud Run service (`juakali-agent`).
- [ ] **[manual] Backup schedule** — run `scripts/backup-convex.sh` on a
      schedule with `CONVEX_DEPLOY_KEY` in CI secrets; push snapshots to S3/GCS.
- [ ] **[manual] Cloud Run structured logging** — thread a request id from
      `/chat` through Convex step calls (follow-up code task, needs the agent
      service deploy pipeline).

## Verification

- Backend: `cd packages/backend && npx tsc --noEmit && npx vitest run`.
- Deployed check: `npx convex deploy` (or `codegen`) succeeds against the target
  deployment; cron list shows `dead-letter failed agent runs`.
