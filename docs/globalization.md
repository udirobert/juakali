# Globalization — global by design, Kenya-first by default

Decision (Nov 2026): the product's moat is the trust loop, not the Kenyan-ness.
Globalize the trust primitives (currency, evidence, rails); localize the entry
(Kenya, Swahili, M-PESA); keep the brand.

## What shipped (code-side, 2026-11-18)

### Currency abstraction (`7ab3397`)
- `convex/schemaCurrency.ts`: single source for ISO 4217 codes — KES default;
  USD, NGN, GHS, PHP, IDR, INR, BRL, ZAR ready. `DEFAULT_CURRENCY = "KES"`.
- `ventures`, `commitments`, `ledgerEvents` carry an optional `currency`
  (legacy rows read as KES — no backfill needed).
- All three pledge mutations accept `currency`; ledger summaries and the
  `publicLedger` / `impactTotals` totals carry it.
- Client: `formatMoney(value, currency)` with per-currency symbols
  (KSh, $, ₦, ₵, ₱, Rp, ₹, R$, R); `formatKes` kept as the KES alias.
  The public ledger hero and row details render the event's own currency.
- Note: numeric fields keep their `*Kes` names for now (a full rename touches
  ~70 sites); the currency field is the source of truth for display.

### PaymentRail interface (`ac9f810`)
- `convex/rails/types.ts`: `PaymentRail` — `verifyThirdParty` (feeds the
  evidence ladder's third-party rung) + `initiateTransfer` (Phase C only;
  default refuses until the regulated-partner track lands). Registry with
  `registerRail` / `getRail` / `listRails`; nothing bypasses it.
- `convex/rails/mpesa.ts`: parses M-PESA confirmation text
  ("QK… Confirmed. Ksh1,250.00 sent to … on 18/11/2026") into structured
  evidence — KES only, deterministic, no LLM.
- `convex/rails/manualStatement.ts`: universal bank-statement fallback so
  every market has a path to the third-party rung before a local adapter lands.
- `convex/railVerify.ts`: `verifyWithRail` mutation — parses the artifact,
  matches the expected amount, stamps `kpiCheckIns` with the `third_party`
  rung and tags the ledger event (`verified-third-party` + rail id).
  Fail-soft: unparseable artifacts return a human message, nothing logged.

### Locale-aware voice parsing (`9c13952`)
- `convex/numberWords.ts`: per-locale number-word tables (sw, en ship).
- `parseKpiValue(transcript, localeOrder)` — digits first, then tables in
  order (default sw→en; wire the venture's locale first when multi-market).

## Deliberately deferred

- **Sector framing rename** ("informal-sector / micro-entrepreneur" in copy
  vs "Jua Kali" as brand) — do when a second market is on the roadmap.
- **Peer benchmarks across markets** — currently single-market; scope by
  currency+market when the second venture lands.
- **Compliance** — the regulated-vehicle partnership is jurisdiction-specific
  by design. Kenya first; replicate the pattern per market, never one global
  instrument.
- **FX conversion** — ledger totals are per-currency; cross-currency rollups
  wait for a real second market (don't build exchange-rate machinery for a
  market that doesn't exist yet).

## Adding a new market (checklist)

1. Add the ISO code to `schemaCurrency.ts` (and the manual-statement rail's
   `currencies` list).
2. Write a `PaymentRail` adapter for the dominant local rail; register it in
   `rails/index.ts`.
3. Add a number-word table to `numberWords.ts` if the locale speaks numbers.
4. Add the locale to the app's i18n surface (founder surfaces first).
5. Find the local regulated vehicle for the instrument — pattern, not product.
