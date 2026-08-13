# Shipaton 2026 — readiness plan

> **What Shipaton is:** RevenueCat's global hackathon for mobile devs, Aug–Sep 2026.
> $700k+ cash prizes + Times Square billboard. Core premise: **actually ship a real
> native app to a real store** (Apple App Store / Google Play), show real traction,
> and monetize (RevenueCat). Categories: Grand Prize (traction/growth), Peace Prize
> (biggest positive impact), Design, #BuildInPublic, Best Game, HAMM (best RevenueCat
> revenue use), Catvertising, **Next Gen** (students: video + source code, **no paid
> app-store account needed**).

JuaKali is a *strong mission-driven candidate* (Peace / Design / #BuildInPublic), but
**not yet a qualified one** — it is currently web-only on Netlify with no store binary
and no monetization. This doc records the gaps and the concrete path to close them.

## Why JuaKali fits

- **RevenueCat Peace Prize** — AI-agent mentorship, transparent public ledger, Kenya
  informal-sector (Jua Kali) venture impact. Ideal "positive impact" narrative.
- **#BuildInPublic Award** — the product literally is "invest in public" (public ledger,
  transparent KPIs, evidence tags).
- **RevenueCat Design Award** — polished Expo UX (identity × fidelity × teaching axes,
  Fraunces / IBM Plex, stone/charcoal/brass shell).

## Current gaps (why it's not yet competitive)

1. **Not on a real store** — only Expo web → Netlify today. Store binary required.
2. **No monetization / no RevenueCat** — product is "soft pledges, non-securities,
   non-settling". No subscription or payment loop, so no revenue traction and no HAMM/Grand Prize story.
## Track A — Native build (EAS) → TestFlight / Play

### Pre-requisites (one-time accounts)
| Requirement | Cost | Notes |
|---|---|---|
| Expo account (EAS) | Free | `npx eas-cli login` |
| Apple Developer Program | $99/yr | Required for iOS store + TestFlight |
| Google Play Console | $25 one-time | Internal testing → review |
| **Next Gen route** | $0 | Students: video + source code only |

### Config
- `apps/default/app.json`: add `ios.bundleIdentifier` + `android.package` (same id),
  `android.versionCode`.
- `apps/default/eas.json`: build profiles (preview APK + production), submit config.
- **Environment at build time** (EAS builds are cold; `EXPO_PUBLIC_*` are inlined):
  - `EXPO_PUBLIC_CONVEX_URL` → prod `zealous-scorpion-285.convex.cloud`
  - `EXPO_PUBLIC_AGENT_URL` → deployed agent Cloud Run URL (NOT `localhost`)
  - `EXPO_PUBLIC_PRODUCT_PRESET` → `app` (quieter returning-investor UX)
  - RevenueCat key: `EXPO_PUBLIC_REVENUECAT_KEY`
  - Set via EAS secrets or `eas.json` `env` — never commit secrets.

### Commands
```bash
npx eas-cli login
eas build:configure
npx expo prebuild --no-install   # generates ios/ android/ (optional; EAS can build bare)
eas build -p android --profile production
eas build -p ios --profile production
eas submit -p ios      # TestFlight → review
eas submit -p android  # Play internal → review
```
Credentials (iOS certs/profiles, Android keystore) are auto-managed by EAS on first build.

### App Store review notes
- Market JuaKali as a **non-financial transparency/mentorship** app; the "soft pledges, not
  securities" framing is an advantage — spell it out in review notes to avoid financial-app scrutiny.
- `newArchEnabled: true` (SDK 55) is fine; run a preview EAS build before store submission.
- Keep the Netlify web export working (judges may run it) — never regress web during native work.
## Track B — RevenueCat subscription tier

### Tier model (maps to Investor home + product axes)
| Tier | Price | Unlocks | Entitlement |
|---|---|---|---|
| **Observer** (free) | $0 | Browse ventures, public ledger, follow 1 venture, view digests | — |
| **Investor** | $9.99/mo | Unlimited soft pledges, weekly agent digests + email, KPI alerts, priority mentorship, multi-venture dashboard | `investor` |
| **Mentor / Pro** | $24.99/mo | Advanced analytics (LTV/cohort), custom KPI targets, export + MCP/API, white-glove onboarding | `pro` |

Both paid tiers are **monthly (+ annual optional)** products created in App Store Connect
and Play Console, mapped to RevenueCat entitlements.

### Implementation (as implemented in this repo)
The SDK is configured **at runtime** (the `react-native-purchases` NPM package ships no
Expo config plugin — only native autolinking dirs):
- `apps/default/components/jua-kali/subscription.ts` — lazy, native-only init of
  `Purchases.configure({ apiKey })` + `getCurrentEntitlements()`; guarded so **web is untouched**.
- `apps/default/components/jua-kali/paywall.tsx` — tier cards, `purchaseStoreProduct`,
  **Restore Purchases**, `presentCodeRedemptionSheet`; gated to native (web shows an inline note).
- Backend `packages/backend/convex/subscriptions.ts` — `getMyEntitlements` query +
  internal `setEntitlements` mutation; `subscriptions` table in schema.
- `packages/backend/convex/http.ts` — `POST /webhooks/revenuecat` validates the
  `Authorization: Bearer <secret>` header (RevenueCat auth key) and updates entitlements
  **server-side** (authoritative), matching the existing `/webhooks/agentmail` pattern.

### Feature-flag alignment
Tie monetization to the existing fidelity/preset system (`EXPO_PUBLIC_PRODUCT_PRESET` +
`fidelity !== "live"`): demo stays **soft, non-monetized**; `live` mode (store build) shows
the paywall and gates Investor/Pro. This keeps the demo clean for Gemini X Prize / mvp
pitches and app-store review.

### Regenerate Convex bindings
The `subscriptions` table + function are new; after pulling, run `npx convex dev`
(or `npx convex codegen`) in `packages/backend` so the runtime `_generated` bindings
(`api.js` / `server.js` / `dataModel.d.ts`) include `subscriptions`. Only `api.d.ts`
regenerates offline; the rest need a real Convex connection.

### End-to-end flow
`eas build` → stores → RC products → user subscribes → RC webhook → Convex sets
entitlement → UI unlocks Investor/Pro (digests, analytics, MCP).

## Recommended ordering

1. **Native build via EAS → TestFlight** (store presence is the hard requirement).
2. **RevenueCat with a single paid tier** (Investor monthly) — qualifies for HAMM and real revenue traction.
3. If a submitter is a **student**, run **Next Gen** in parallel (video + source code) as a no-cost entry.

## Next open questions
- Final tier pricing / entitlement names per persona (affects paywall copy).
- Production RevenueCat `apiKey` (public SDK key) + webhook auth key (`REVENUECAT_WEBHOOK_SECRET`).
- Store app id + bundle id finalization before first build.
3. **No real traction metrics** — seeded demo, not real MAU / revenue.