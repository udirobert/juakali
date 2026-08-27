# Motion · Loading states · Engagement (native polish)

Cohesive upgrade of the JuaKali mobile/web shell. The app already carries a strong
design system (theme.motion tokens, LivingSun, PressableScale, useUiMotion, count-up).
This pass adds the *missing native primitives* rather than re-theming.

## 1. Skeleton loading primitive — `ui/skeleton.tsx` ✅
Reused branded shimmer (reduced-motion aware: static fill when OS asks for less).
`Skeleton` / `Skeleton.Text` / `Skeleton.Stack` via namespace merging. Replaces the
bare `ActivityIndicator` boots so first meaning arrives before data does.

## 2. Branded skeletons ✅
- `loaders/today-skeleton.tsx` → Today briefing boot (hero sun, greeting, cards).
- `loaders/ledger-skeleton.tsx` → Public ledger boot (hero, chips, feed rows).
Both preview the exact layout to minimize layout shift.

## 3. Transitions ✅
- Root `Stack` gets a native screen transition (`slide_from_right` on native; none on web).
- Ledger rows get a mount-only fade-in entrance stagger (`FadeIn`, capped delay);
  guarded by reduce-motion, cheap (no layout anim).
- Today briefing does a single fade on the skeleton → content swap.

## 4. Engagement loop / viral hook ✅
- Ledger "Share" upgraded from a text link into a tactile `PressableScale` "Share proof"
  pill with scaffolded border + `successHaptic()` on completion — the shareable-proof
  loop becomes first-class and feels native.

## Compliance
All animations respect `useReducedMotion`; durations stay under 300ms except authored
hero moments; no per-row layout animations in long lists.