# Invest in Public MVP

## Status: completed (investor UX + AgentMail scaffold + artifact polish)

## UX grammar (Home)

- Artifacts over chat: digest card (summary / insight / next / evidence); thread collapsed by default.
- One shimmer while queued/acting; idle surfaces still.
- Approval card before tools; Acting · Ns elapsed; tool cards spinner→check.
- No WebGL / confetti on fiduciary surfaces; respect reduced motion.

## Goal
Ship a demoable full thin loop for investor leads: soft revenue-share microcommitments, AI agent mentorship / KPI logging / digests, investor home, and a public ledger — while keeping voice/SMS matching as funnel scaffolding.

## Steps
- [x] Rewrite README + link historical matcher plan
- [x] Add invest schema tables + `invest.ts` APIs and seed
- [x] Add Public Ledger + Investor Cockpit UI tabs
- [x] Extend Gemini agent + MCP tools for invest flows
- [x] Seed CTA, copy safeguards, dry-run 3-minute script
- [x] Collapse IA to Investor home (default) + Ledger; hide Funnel/Ops behind Lab
- [x] Email ritual primitive (scripted thread → KPI/digest; AgentMail later)
- [x] Venture scorecard, next digest due, peer benchmark, evidence tags
- [x] Safe-area + compact mobile pass
- [x] CopilotKit-inspired approve gate + tool-result cards
- [x] AgentMail webhook scaffold (`/webhooks/agentmail`) → same mutations

## Decisions
- Investor is the client; apprentice venture is the investee.
- Demo instrument: revenue-share framing with soft `pledged` amounts (no payments/escrow).
- Busy-investor UX: one quiet home, visible email ritual, few trustworthy numbers — not five equal tabs.
- Email: in-app queue→approve today; AgentMail webhook uses the same `processInvestorEmailNote` path. Gmail OAuth later. No LangGraph until loops need durable branching.
- Public ledger queries are unauthenticated for demo transparency.
- Matching telephony stack remains intact as top-of-funnel (Lab only).

## Demo script (~3 min)
1. **Home** → Seed if empty → show How it runs + scorecard.
2. Queue email → **Approve send** → tool cards (KPI, digest, ledger, reply).
3. **Ledger** → prove the same events are public.

## Product UX (busy investor)
- **Default:** Investor home — not a five-tab console.
- **Ritual:** Queue email → approve → agent tools (KPI, digest, ledger, reply).
- **Trust:** KPI vs target, peer median, evidence tags, next digest cadence.
- **Email path:** In-app ritual today; AgentMail webhook at `/webhooks/agentmail` (same mutations). Gmail OAuth later.
- **Avoid:** Vanity AI scores, LangGraph until loops need durable branching.

## Notes
- Avoid claiming regulated securities in UI copy.
- AgentMail svix signature verification is TODO before production.
- Tasteful trust only: cadence, evidence source tags, peer median — no vanity AI confidence scores.
- README stays short and links here for UX / demo / decisions.
- Live review: Netlify (Expo web) + Convex prod `zealous-scorpion-285` (Papa Jams / `juakali`). Agent Cloud Run optional for Lab.
- After first Netlify URL is known, set Convex `SITE_URL` to match (`convex env set SITE_URL … --prod`).
