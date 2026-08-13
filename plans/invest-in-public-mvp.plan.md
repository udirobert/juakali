# Invest in Public MVP

## Status: MVP loop + soft identity + AgentMail inbound live

Product mode spine (identity × fidelity × teaching, demo vs app presets): [product-axes.md](product-axes.md).

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
- [x] AgentMail live: inbox `juakali@agentmail.to` + Svix-verified webhook on Convex prod

## Decisions
- Investor is the client; apprentice venture is the investee.
- Demo instrument: revenue-share framing with soft `pledged` amounts (no payments/escrow). Fidelity badge always visible while not `live`.
- Busy-investor UX: one quiet home, visible email ritual, few trustworthy numbers — not five equal tabs.
- Email: **dual path** — in-app queue→approve, **or** email `juakali@agentmail.to` (AgentMail). Same `processInvestorEmailNote` path. Webhook Svix-verified. Optional subject `venture:<slug>`. Gmail OAuth for the human investor later. No LangGraph until loops need durable branching.
- Fidelity split: capital stays **soft** (not escrow); agent inbox inbound is **live**.
- Public ledger queries are unauthenticated for demo transparency (**public by default**).
- Mode scoping = **auth × fidelity (± env)**; “demo” is a preset (loud teaching), not a forked IA. Netlify ships `EXPO_PUBLIC_PRODUCT_PRESET=demo`.
- Teaching fades with competence (first run / session / long absence) — not hostname.
- Matching telephony stack remains intact as top-of-funnel (Lab only).

## Demo script (~3 min)
1. **Home** → Seed if empty → show How this works + scorecard + agent inbox.
2. Queue note → **Approve & run** → tool cards (KPI, digest, ledger, reply) — *or* email `juakali@agentmail.to`.
3. **Ledger** → prove the same events are public.

## Product UX (busy investor)
- **Default:** Investor home — not a five-tab console.
- **Ritual:** In-app queue → approve, **or** AgentMail inbound → agent tools (KPI, digest, ledger, reply).
- **Trust:** KPI vs target, peer median, evidence tags, next digest cadence; fidelity badge (soft capital).
- **Email path:** `juakali@agentmail.to` + `/webhooks/agentmail` (Svix). In-app ritual still primary for demos. Gmail later.
- **Visual:** Centred “Nairobi ledger” shell (stone / charcoal / brass + Fraunces / IBM Plex). Quiet motion only.
- **Useful from beautiful-ui primitives:** approval choices, tool chips, insight cards, elapsed acting — not marketing fireworks.
- **Avoid:** Vanity AI scores, LangGraph until loops need durable branching.

## Next (toward investor-primary web)
- [x] Soft identity (email magic link) + optional act gate
- [x] Persist onboarding/coach on userPrefs when authenticated
- [x] AgentMail inbox bound + Svix webhook secret on Convex
- [ ] Production Resend for soft-identity magic links + disable `SOFT_AUTH_INBOX` peek
- [ ] Gmail for human investor; capital may stay soft while email stays live
- [ ] Optional ICS for digest cadence (not full calendar OAuth yet)

## Notes
- Avoid claiming regulated securities in UI copy.
- AgentMail Svix verification is **on** when `AGENTMAIL_WEBHOOK_SECRET` is set (prod).
- Tasteful trust only: cadence, evidence source tags, peer median — no vanity AI confidence scores.
- README stays short and links here + [product-axes.md](product-axes.md).
- Live review: Netlify (Expo web) + Convex prod `zealous-scorpion-285`. AgentMail inbox `juakali@agentmail.to`.
- Tester reset: `?fresh=1`, or **Help → Show intro again**. Force loud teaching: `?demo=1`.
