# Phase 1 — Harden: ops checklist

From the level-up plan (Nov 2026). Items marked **[manual]** need an account owner
(they involve billing or external dashboards); everything else is code-side.

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

- Backend: `cd packages/backend && npx tsc --noEmit && npx vitest run` (53 tests).
- Deployed check: `npx convex deploy` (or `codegen`) succeeds against the target
  deployment; cron list shows `dead-letter failed agent runs`.
