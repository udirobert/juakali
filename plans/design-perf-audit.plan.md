# Design / UX / Interface / Performance — path to 8/10

Audit basis: exported web build (`expo export -p web`), browser session on
landing + ledger, code review of cockpit, ledger, proof, fund-on-BCH, gate.

## Audit scores (before)

| Dimension | Score | Key findings |
|---|---|---|
| Visual design | 7.5 | Strong editorial identity (Fraunces/Plex, stone/brass, halftone print motif). Landing thin below fold, ends abruptly; one muddy halftone plate; "a article" seed-copy bug in the live ledger card. |
| UX clarity | 5.0 | Public ledger gated by onboarding landing (no auth required — `publicLedger` serves anon, deep links with `?ledger=` already skip the gate). No "browse the record" path from landing. |
| Interface quality | 7.0 | Crafted moments (print sweep, verify lens, settlement rail, FLIP). Partial `accessibilityRole` coverage; heavy mid-word truncation. |
| Performance | 4.0 | ~5.1MB uncompressed JS entry (no route splitting; BCH stack in entry). 24 TTFs ship (~5 load). No list virtualization. |
| Accessibility | 5.0 | VerifyLens is a real button w/ label; reduced-motion honored. Roles ~50% of pressables; no focus-visible styles; no axe run ever. |
| Trust legibility | 6.5 | Soft-vs-settled honest everywhere built — but invisible to anonymous visitors because proof surfaces sit behind the onboarding gate. |

## Phase A — Public record, actually public

- [x] A1: `onboarding-gate.tsx` — `useSegments()` last-segment check lets
      `/(tabs)/proof` bypass `showLanding` (all other tabs still gated).
- [x] A2: `investor-onboarding.tsx` — "THE LEDGER, LIVE" card is pressable
      ("Read the full record →") + "or read the public record →" link under
      the CTA; `onEnter({ publicLedger: true })` routes to `/(tabs)/proof`.
- [x] A3: `app/proof/[eventId].tsx` verified — no client auth checks;
      backend `proofEvent` already fails closed for private events. The
      route sits outside `(tabs)` so it was never gate-wrapped.
- [x] A4: already existed — `/deal/{slug}` proxies to `/share/ledger` which
      emits full OG/Twitter Card meta; humans meta-refresh into
      `?ledger={slug}` (which already skipped the gate). Added `Head`
      title/description on the proof screen.

**OPEN — needs verification by owner (browser session unreliable):**
`/(tabs)` rendered an empty screen (1 div, no console errors) on the static
export for an anonymous session — observed at both `/proof` (post-bypass)
and `/today` (post-landing). Suspicion: `unstable-native-tabs`' web fallback
(Radix) doesn't mount on cold-load, or a slow init was misread. If confirmed
real, anon visitors get a blank tab shell — which would make A1/A2 moot until
fixed. Check: fresh incognito on prod → click "Try the demo" → does the tab
shell render? If it does, this was a local-serve artifact.

Acceptance: incognito → `/proof` renders ledger → `/proof/{eventId}` renders
record + lens → `/deal/{slug}` unfurls with OG. Private events stay closed.

## Phase B — Landing depth & polish

- [ ] B1: Expand 3-step strip into a "How it works" section (pledge → weekly
      proof → public record; step 3 links to ledger).
- [ ] B2: Footer — wordmark, public-record link, docs/GitHub, honesty line.
- [ ] B3: Fix "a article" + audit seed summaries.
- [ ] B4: Per-image lift/gamma param on `LedgerPrintImage` for dark sources
      (or swap artisans plate).
- [ ] B5: `numberOfLines={2}` clamps where hard ellipsis cuts mid-word.

## Phase C — Performance (4 → 8)

- [ ] C1: `experiments.bundleSplitting: true` in app.json (verify Expo 57
      flag; fallback `EXPO_UNSTABLE_METRO_BUNDLE_SPLITTING=1`) — per-route
      chunks.
- [ ] C2: `React.lazy` + `Suspense` for `fund-on-bch` in cockpit; dynamic
      `import("@wizardconnect/react")` in `use-bch-wallet` if needed.
      Target: entry < ~1.5MB raw.
- [ ] C3: `FlatList` for public-ledger rows (`ListHeaderComponent` for hero).
- [ ] C4: Prune unused font assets (only 5 of 24 TTFs load).
- [ ] C5: Measure: chunk manifest + resource totals in browser session.

## Phase D — Accessibility (5 → 8)

- [ ] D1: `accessibilityRole="button"` + labels on all pressables (cockpit
      3/8, fund card 1/4, ledger rows, seals, rail).
- [ ] D2: `accessible={false}` on decorative views; fold meaning into parent
      labels ("Faith Tailoring Line, settled on Bitcoin Cash, KES 40,000").
- [ ] D3: `accessibilityRole="header"` on section titles.
- [ ] D4: `:focus-visible` outline via injected stylesheet (RN-web has none).
- [ ] D5: axe-core sweep on landing/ledger/proof; fix violations (mist-on-
      paper contrast at small sizes is the expected flag).
- [ ] D6: Keyboard-only flows: chip select, row expand, lens pin.

## Phase E — Residual polish

- [ ] Empty states (filtered ledger, zero deals, post-scan wallet).
- [ ] Skeleton cards vs bare spinners on ledger + cockpit.
- [ ] Reduced-motion audit; mobile 390px re-verify.

## Sequencing

A → B (shared surfaces; B's links need A's destination) → C → D → E.
Each phase closes with tsc + eslint + `expo export -p web` + scoped browser
session; each lands as its own commit.

## Risks

- A3 may reveal screen-level auth assumptions in proof/[eventId] beyond the
  backend's visibility filter — check before assuming A1 is sufficient.
- Bundle-splitting flag name/behavior varies by SDK — verify against Expo 57
  docs before enabling; keep a no-splitting fallback (dynamic imports still
  help if Metro chunks them).
