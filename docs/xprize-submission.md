# Gemini X Prize — JuaKali submission

**Category entered:** Entrepreneurship & Job Creation.
**Product:** JuaKali — soft revenue-share microcommitments into Kenya informal-sector ("Jua Kali") ventures, mentored by an AI agent that publishes a transparent public ledger. (Soft pledges are not securities or live settlement; the capital instrument is a deliberate prototype-level choice so the workflow itself can be evaluated.)
**Stack (during submission window):** Expo (Netlify web) · Convex prod (`zealous-scorpion-285`) · **Gemini 3.6 Flash on Google Cloud Run** · AgentMail inbound · MCP tools.

## What runs on Google Cloud

- **Cloud Run service:** `juakali-agent` in project `cognivern`, region `us-central1`.
  - Source image: `gcr.io/cognivern/juakali-agent:latest`.
  - Active revision: `juakali-agent-00002-pnl` (kept >= 1 live revision during the 90-day window).
  - URL is publicly reachable; `/chat` is bearer-token gated.
- **AI Studio API key:** lives in a separate Google Cloud project (`AI Studio → API keys`, project number redacted in the written narrative per Devpost's discretion). The key calls `gemini-3.6-flash`.

The Cloud Run service did the **AI-native operations and live decisions** the entry is judged on: each `/chat` request resolves a real Convex call, returns a Gemini-grounded reply, and writes evidence rows (KPI check-in, digest, ledger event) inside the same backbone the Expo app uses.

## Endpoints

- `GET /health` → `"JuaKali Agent is ready"` (200, no token)
- `POST /chat` → `{"message": "..."}`; `Authorization: Bearer <AGENT_CHAT_TOKEN>` required.
- `POST /webhooks/voice` · `/webhooks/sms` · `/webhooks/ussd` (telephony stack kept for the funnel; same agent service).

## Why Gemini 3.6 Flash (and not 2.5 Flash)

The Gemini API key for this submission was provisioned for the AI Studio project after `gemini-2.5-flash` was retired for new accounts. The first end-to-end test returned `404 Not Found: models/gemini-2.5-flash is no longer available`. We retargeted on `gemini-3.6-flash`, the lowest-quota, lowest-cost Flash tier available to this key. We verified with `curl https://generativelanguage.googleapis.com/v1beta/models?key=…` that `gemini-3.6-flash` was the supported Flash model.

## Free-tier quota (operational constraint, not architectural)

The AI Studio API key is on the free tier → **5 requests/minute per model**.

- `/chat` calls that do **not** trigger tool use work reliably under free-tier limits.
- The 90-day window's traffic pattern was designed so the user-facing flow (in-app ritual + AgentMail inbound) stays under the per-minute cap; tool-using chats compile to one `generate_content` call per follow-up turn, which honors the cap.
- A paid Gemini key would let tool-using `/chat` calls run continuously. This was a deliberate scope choice for the 90-day build window.

## Submission-time verification artifacts

These should be captured into the repo's `docs/xprize-submission/evidence/` folder before the deadline:

1. `cloud-run-service.png` — Project `cognivern` → Cloud Run → `juakali-agent`. Shows URL, region, latest revision.
2. `cloud-run-revision.png` — Container image details showing `gcr.io/cognivern/juakali-agent:latest` and the digest baked by Cloud Build.
3. `cloud-run-logs.png` — Cloud Run logs view showing at least one `/chat` request with status 200 and a non-trivial Gemini latency.
4. `ai-studio-api-keys.png` — AI Studio → API keys with the key ID redacted but the *project number* visible — proves the Gemini ↔ Cloud Run link.
5. `ai-studio-usage.png` — AI Studio → usage graph showing requests against `gemini-3.6-flash` (redact request totals to your taste).
6. `chat-curl.txt` — A copy-pasteable transcript of a `/chat` call against the deployed URL. Include the bearer token *placeholder* (not the real value).
7. `convex-agent-runs.png` — Convex dashboard → Tables → `agentRuns` showing live rows created during the 90-day window, with at least one tool-using run.
8. `convex-ledger.png` — Convex → `ledgerEvents` showing capital → actions → results traces.

The repo-level `README.md` was updated to point to this document.
