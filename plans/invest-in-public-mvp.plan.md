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
- Email: **dual path** — in-app queue→approve, **or** email `juakali@agentmail.to` (AgentMail). Both paths run the same durable `agentRuns` pipeline (see below). Webhook Svix-verified. Optional subject `venture:<slug>`. Gmail OAuth for the human investor later. No LangGraph until loops need durable branching.
- Fidelity split: capital stays **soft** (not escrow); agent inbox inbound is **live**.
- Public ledger queries are unauthenticated for demo transparency (**public by default**).
- Mode scoping = **auth × fidelity (± env)**; “demo” is a preset (loud teaching), not a forked IA. Netlify ships `EXPO_PUBLIC_PRODUCT_PRESET=demo`.
- Teaching fades with competence (first run / session / long absence) — not hostname.
- Matching telephony stack remains intact as top-of-funnel (Lab only).
- **Truthful agent runs**: approve & run creates a durable `agentRuns` record; each step (KPI → digest → ledger → reply) commits in its own transaction and the cockpit streams real step state via subscriptions. No simulated chips, no artificial delays. Inbound AgentMail uses the same pipeline (trigger `inbound_email`), so email-triggered work streams live too. A cron fails runs stuck >90s.
- **Digest is a first-class artifact**: `latestDigest` carries summary, insight, next action, and evidence tags; rendered as a dedicated digest card with "View on Ledger".
- **Landing shows the product, not a diagram**: headline + live public-ledger artifact (real `publicLedger` rows) replace the You/Agent/Ledger loop schematic. Primary CTA = "Watch a deal come alive" (seed → cockpit); own commitment is the slim secondary path (name · venture · deal). Brass SunMark (jua = sun) is the repeated brand motif (landing, digest card, ledger hero).
- **Approval gate previews consequences**: the queued card lists what approving will do (KPI, digest, ledger, reply) and the approve button is brass — visually distinct from navigation.
- **Welcome-back is one line**: session re-orientation is a single compact bar with How it works / Terms / Dismiss — no stacked teaching cards.
- **The agent is named Jua** (jua = sun; "to know" in Swahili). SunMark is its face, repeated as the brand motif (landing, digest card, ledger hero, chat header); replies and digest copy sign "— Jua · JuaKali agent".
- **One visual language everywhere**: Lab (Funnel/Ops) remapped from sage/terracotta/cream onto the ledger tokens (stone/charcoal/brass); Fraunces/Plex also for Lab headings.
- **Auth at the moment of intent**: after opening a commitment while signed out, a "Save your pledge, {name}" step captures email (magic link) or Google (web) before entering the app; skip-for-now stays possible. UI copy drops infra jargon ("Soft identity" → "Sign in"; no AUTH_* strings user-facing). Signed-in users get a named greeting. Canonical slogan everywhere: "Deals = act · Ledger = public proof".
- **Ledger is the shareable proof surface**: `ledgerEvents.evidence` tags record where each entry came from (`email`/`agent`/`sms`/`whatsapp` + `agent`), rendered as small chips per row. `publicLedger` accepts `ventureSlug` to scope events + totals to one deal; the ventures-with-events list powers horizontal filter chips. Ledger rows get type glyphs (◈ capital · ▲ KPI · ✎ digest · ⚡ action). The pledged total is the hero number (40px display). Every deal is shareable: cockpit scorecard + ledger Share button produce `?ledger=<slug>` links; the URL stays in sync with the active filter.
- **Per-deal OG meta — no edge functions**: share links use a real path, `/deal/<slug>` (crawlable, not a query param). Netlify's `[[redirects]]` proxies `/deal/*` → Convex HTTP route `/share/ledger?slug=...` (status 200). Convex serves a static HTML shell with live per-deal `og:*` (name · pledged · KPIs · digests from `internal.dealShare.getShareData`) and a meta-refresh that sends humans into the SPA at `/?ledger=<slug>`. Deterministic serverless function, no UA sniffing, no edge runtime to babysit; deploys atomically with the schema.
- **Accessibility baseline**: meta text (`mist`) darkened to ~5.5:1 on paper; all small uppercase brass text moved to `brassDeep` (~5.6:1) — AA at 9–12px sizes.
- **The agent mentors, it does not operate**: user-facing copy never claims the agent runs the ventures. Jua *follows / mentors / monitors* each venture — the founder operates it. Landing subhead, site meta description, and the agent system prompt all say mentor + monitor + make visible.
- **Quiet home, one idea per surface**: nav tabs carry labels only (no stacked hints like "Act here"); the "Deals = act · Ledger = proof" bridge renders once (mobile help bar, or desktop hero — not both); the deals strip drops its redundant "Your deals" caption (the hero already greets you); the scorecard no longer repeats the digest-due date or prints the raw share slug.
- **Teaching behind taps (progressive disclosure)**: the How-it-works coach collapses to one line ("Open a deal · Send a note to Jua · Check public proof") with a "See the 3 steps" reveal; step copy trimmed to a sentence each. The Email panel shows the inbox address by default, with one-line detail on expand; the fidelity caveat lives on the always-visible badge, not duplicated in the panel.

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
