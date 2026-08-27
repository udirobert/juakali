# JuaKali ops

**Private.** Do not commit `AGENT_CHAT_TOKEN`, `AGENTMAIL_API_KEY`, `AGENTMAIL_WEBHOOK_SECRET`, `GOOGLE_API_KEY`, or `AUTH_RESEND_KEY` values. Use the form `<key>=…` for documentation only.

## Active Cloud Run service (X Prize submission window)

| | |
|---|---|
| Service | `juakali-agent` |
| Region | `us-central1` |
| Project | `cognivern` |
| Image | `gcr.io/cognivern/juakali-agent:latest` |
| Source | `packages/agent/` (this repo) |
| Builder | Cloud Build (`Dockerfile`) |
| Currently deployed revision | `juakali-agent-00002-pnl` |
| Service URL | `https://juakali-agent-2hfdtkdrnq-uc.a.run.app` (the canonical URL is captured locally; see `~/.juakali-submission/cloud-run.txt` on the build machine). |

### Endpoint contract

- `GET /health` — public, no token. Returns `"JuaKali Agent is ready"`.
- `POST /chat` — `Authorization: Bearer $AGENT_CHAT_TOKEN`. Body `{ message: string }`.
- `POST /webhooks/{voice,sms,ussd}` — telephony stack kept for the funnel.
- `AGENT_CHAT_TOKEN` is generated locally and passed via `--set-env-vars`; rotate by re-deploying.

### Smoke test (post-deploy)

```bash
SERVICE_URL=https://juakali-agent-2hfdtkdrnq-uc.a.run.app
curl -s "$SERVICE_URL/health"                             # 200, "JuaKali Agent is ready"
curl -s -X POST \
  -H "Authorization: Bearer $AGENT_CHAT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"What did you last do on the JuaKali prototype?"}' \
  "$SERVICE_URL/chat"
```

### Gemini model selection

- We use `gemini-3.6-flash` (AI Studio free tier for the project that owns the API key).
- Constraint: **5 RPM per model on free tier**. Tool-using chats send one `generate_content` per follow-up turn; the in-app ritual and AgentMail inbound stay under this cap. If we move to a paid key, drop this section.
- Why not `gemini-2.5-flash`? It was retired for new accounts by the time the API key was generated; the key returns `404` on `models/gemini-2.5-flash`.

### Re-deploy (with a rotated AGENT_CHAT_TOKEN)

```bash
cd /path/to/juakali-app
NEW_TOKEN=$(openssl rand -hex 24)

# Optional: rebuild only if you changed source.
gcloud builds submit packages/agent \
  --tag gcr.io/cognivern/juakali-agent \
  --project=cognivern

gcloud run deploy juakali-agent \
  --image gcr.io/cognivern/juakali-agent \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars "GOOGLE_API_KEY=${GOOGLE_API_KEY},CONVEX_SITE_URL=https://zealous-scorpion-285.convex.site,AGENT_CHAT_TOKEN=${NEW_TOKEN}" \
  --project=cognivern
```

## Convex backend deploy

```bash
cd packages/backend
npm run deploy          # convex deploy --env-file ../../.env
```

- Deploys to prod (`zealous-scorpion-285`, selected via `CONVEX_DEPLOYMENT` in `.env`).
- **Auth-config env trap (cost us Aug 17–27):** `auth.config.ts` must NOT import
  the shared `env` object. Convex's deploy-time check evaluates the auth
  config's whole dependency graph against the deployment's env vars and rejects
  the push (`AuthConfigMissingEnvironmentVariable`) if any declared variable is
  unset — including optional integrations we deliberately leave unset (Resend,
  Twilio, Africa's Talking, Gemini, RevenueCat). `CONVEX_SITE_URL` is
  auto-injected, so the auth config reads it from `process.env` directly
  (fixed in `d8f3b6b`; do not regress this).
- Do NOT "fix" that check by setting placeholder values on the deployment:
  e.g. a fake `AUTH_RESEND_KEY` would flip soft-identity email from inbox-peek
  mode to live Resend sends.

### 2026-08-27 catch-up deploy (incident)

Prod was running a bundle predating `6ef792c` — the app queried functions the
backend didn't have (`invest:todayBriefing` → "Could not find public function").
Every deploy since Aug 17 had been blocked by the auth-config trap above.

- Deployed `d8f3b6b` (all pending backend work; 6 indexes backfilled by Convex).
- Ran all three migrations: `backfillInvestorBriefings` (2 investors),
  `backfillLedgerEventVentureMeta` (10 events), `backfillVentureBrowse`.
- Schema is currently WIDENED: `investorBriefings.cockpit`/`presence` are
  `v.optional` with a scan fallback in `investorCockpit` (defense against
  deploy skew; `ad3294a`). See the parking lot for the narrow step.

## Local secrets (kept off-disk)

- We never write `GOOGLE_API_KEY` or `AGENTMAIL_*` values to files. Shell history: clear it after the deploy run.
- `AGENT_CHAT_TOKEN` is generated per deploy, not stored in source control, and lives at most on the build machine in `~/.juakali-submission/cloud-run.txt` (`chmod 600`).
- Postgres-style maintenance: **none for Convex** (managed). Convex deployment id is `zealous-scorpion-285`.

## Backlog (not shipped during the 90-day window)

- [ ] Production Resend for soft-identity magic links (turn off `SOFT_AUTH_INBOX` peek).
- [ ] Gmail for human investor; capital stays soft while email stays live.
- [ ] Optional ICS for digest cadence (not yet full calendar OAuth).
- [ ] RevenueCat: subscription tier + `subscriptions` table + `getMyEntitlements` + `/webhooks/revenuecat` Bearer-secret signed. Scaffolded; not wired to a real store binary yet (see `plans/shipaton-2026-readiness.md`).
- [ ] Paid Gemini API key (free-tier 5 RPM cap is the single largest non-design constraint right now).

## Decommission checklist (post-deadline, run only after submission window closes)

This is real billing-eligible tearing down. **Do not run until judges no longer need the URL.**

```bash
# 1) delete the live service (irreversible; idempotent on second run)
gcloud run services delete juakali-agent \
  --region us-central1 \
  --project=cognivern

# 2) delete the registry image (also irreversible)
gcloud container images delete gcr.io/cognivern/juakali-agent:latest

# 3) optionally revoke / rotate the AI Studio API key
# (do this in the AI Studio console for the project that owns the key)

# 4) remove local secrets from the build machine
rm -rf ~/.juakali-submission
unset AGENT_CHAT_TOKEN
unset GOOGLE_API_KEY
unset AGENTMAIL_API_KEY
unset AGENTMAIL_WEBHOOK_SECRET
unset AUTH_RESEND_KEY
```

If you're unsure whether the deadline has fully closed, **don't delete** — judging clarifications occasionally request the URL to still be live.

## Things to remember to do (parking lot)

- Narrow `investorBriefings.cockpit`/`presence` back to required and drop the
  `investorCockpit` scan fallback — safe once we're confident every index doc
  carries the projection (all docs written since 2026-08-27 do).
- Rotate `AGENTMAIL_API_KEY` and `AGENTMAIL_WEBHOOK_SECRET` — both values were
  printed into a terminal session during the 2026-08-27 incident debugging.
- Decide whether to flip `GOOGLE_API_KEY` from AI Studio free tier to a paid key before next real users land. Current burn: probably tolerant for prototype; not for production traffic.
- After the X Prize window, decide whether `cognivern` is still the right home for the Cloud Run service. It is currently the active GCP project, but the Gemini API key lives in a separate project (`AI Studio`).
- Re-verify the bearer-token rate-limiter before opening `/chat` to third parties. Right now there is rate-limit work inside Convex for the investment mutations, but the agent endpoint itself is token-gated only.
