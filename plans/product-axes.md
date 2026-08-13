# Product axes — Invest in Public

JuaKali is a novel primitive (public microcommitments + agent ops). Category rules are ours to write, but **mode scoping follows industry spines**, not a parallel “demo app vs real app.”

## Axes (compose; don’t fork IA)

| Axis | Question | States (now → next) |
|---|---|---|
| **Identity** | Who is this, and what persists? | `anonymous` → `soft` (email/link) → `authenticated` |
| **Fidelity** | Is capital / inbox / risk real? | `mock` (seed) · `soft` (intent capital; inbox may be live) · `live` |
| **Environment** | Which backend? | local · Convex prod (Netlify review) · future staging |
| **Teaching** | How loud is orientation? | `loud` · `soft-return` · `quiet` |

**One IA everywhere:** My deals · Public ledger · (Lab internal). Teaching and fidelity change *chrome and gates*, not navigation.

### Rules we commit to

1. **Public by default** — ledger readable without auth.
2. **Identity to act** (target) — pledge / approve / bind email require soft or full auth; not required yet while anonymous demo leads.
3. **Fidelity always labeled** — never imply escrow or securities when capital is soft; badge text may note live agent inbox separately.
4. **Teaching fades with competence** — emptiness, first run, long absence — not hostname.
5. **Demo is a preset**, not a product fork — anonymous + soft/mock fidelity + louder teaching.

### Presets (bundles on the axes)

| Preset | Typical use | Identity | Fidelity | Teaching |
|---|---|---|---|---|
| **`demo`** | Netlify review, `?demo=1`, cold testers | anonymous OK | soft (labeled) | **loud** — session welcome-back, session coach, `?fresh=1` |
| **`app`** | Investor-primary web / native | prefer auth | soft → live later | **quiet** when authed; **soft-return** when anonymous |

Env: `EXPO_PUBLIC_PRODUCT_PRESET=demo|app`  
URL overrides: `?demo=1` (force demo teaching), `?fresh=1` (clear local gates).

### Teaching policy detail

- **loud** — new browser session → Welcome back; coach dismiss is session-scoped.
- **soft-return** — welcome only after ~14 days away (or never oriented); coach dismiss durable.
- **quiet** — no auto welcome; Help / Terms / `?` only; coach dismiss durable.

### Fidelity labels (UI)

| Mode | Badge | Meaning |
|---|---|---|
| mock | Mock · seed data | Example ventures / scripted ritual |
| soft | Soft · not settling | Intent pledges; **not escrow**. AgentMail inbound may still be live. |
| live | Live | Real settlement / full inbox sync (capital live not shipped) |

**Current prod split:** capital = soft · agent inbox inbound = live (`juakali@agentmail.to`).

### Build sequence

- [x] Document axes + presets
- [x] `lib/product-mode.ts` resolver + `FidelityBadge` in shell
- [x] Teaching gates follow preset (`demo` → loud session welcome; `app` → soft-return / quiet)
- [x] Netlify + `.env.example` set `EXPO_PUBLIC_PRODUCT_PRESET=demo`
- [x] Soft identity (email magic link via `soft-email` provider)
- [x] Server `REQUIRE_AUTH_TO_ACT` gates pledge / approve / seed / startCommitment
- [x] `userPrefs` for onboarded / coach / lastOriented when authenticated
- [x] AgentMail inbox `juakali@agentmail.to` + Svix-verified `/webhooks/agentmail`
- [ ] Production Resend (`AUTH_RESEND_KEY`) + turn off `SOFT_AUTH_INBOX`
- [ ] Gmail for human investor
- [ ] Calendar = cadence copy + optional ICS before OAuth

Convex Auth is already wired in the Expo shell; invest mutations remain open for the anonymous demo loop until identity-to-act lands.

### Code map

| Concern | Where |
|---|---|
| Soft identity UI | `apps/default/components/jua-kali/soft-identity.tsx` |
| Soft email provider | `packages/backend/convex/softEmail.ts` |
| Auth link / prefs / act assert | `packages/backend/convex/softAuth.ts` |
| AgentMail setup / Svix verify | `packages/backend/convex/agentMail.ts` |
| AgentMail config (no secrets) | `packages/backend/convex/agentMailPublic.ts` |
| AgentMail webhook HTTP | `packages/backend/convex/http.ts` → `/webhooks/agentmail` |
| Resolve preset / teaching / fidelity | `apps/default/lib/product-mode.ts` |
| Session vs durable orientation | `apps/default/components/jua-kali/session-persist.ts` |
| Fidelity chrome | `apps/default/components/jua-kali/fidelity-badge.tsx` |
| Welcome back / coach / glossary | `apps/default/components/jua-kali/help.tsx` |
| Landing + welcome gate | `apps/default/components/jua-kali/investor-onboarding.tsx` |
| Shell wiring | `apps/default/app/index.tsx` |
