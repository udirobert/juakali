# BCH Blaze 2026 — Invest in Public, Settled in Public

## Status: chipnet E2E proven — floor items + ambition ladder in flight

Land so far: schema fields deployed; `lib/bch/` (electrum UTXO scan,
unsigned-tx build, WizardConnect session) implemented; `FundOnBchCard` in the
deal cockpit (web-only); `recordPledgeFunding` / `recordRepayment` /
`setVentureSettlement` mutations live on prod; ledger + proof screens render
txid + blockexplorer.cash links. **Chipnet E2E proven Nov 21**: Cashonize
WizardConnect → faucet tBCH → sign → broadcast → txid `968684c9…437f55`
verified on explorer (four real bugs fixed live: crypto-init race on session
restore, WizardConnect mount-order crash, null-scan render, BigInt relay
serialization → hdwalletv1 canonical wire format). Backend tests 53/53, tsc
clean, web export bundles, Netlify + Convex prod deployed.

## Ambition ladder (ordered by ROI — floor first, always)

1. **Floor** — mainnet tx (minimal funds, recoverable), Widget Factory
   slides pasted, DoraHacks submitted, Telegram check-in. Non-negotiable.
2. **PUSD CashToken output** — code shipped (`buildPledgeSpend` token path,
   category verified `2469acc5…2544`); needs PUSD dust in the demo wallet +
   one tx. Sponsor-aligned demo (prize pool is PUSD).
3. **Demo video** — screen-capture connect → sign → ledger lands; doubles as
   Media track + Community Choice ammo.
4. **Decentralized Identity ($500 PUSD, Paytaca)** — `bchAddress`↔`nostrPubkey`
   binding proof + KPI check-ins as signed Nostr attestations. Fits the
   product story: portable venture reputation.
5. **Community Choice ($750 PUSD)** — publish EMBER2026 receive address;
   no code.
6. **XO covenant** — Migrate to XO (1 BCH ×5): repayment-split covenant is the
   product's contract. Biggest prize, highest risk (pre-release toolchain);
   only if everything above lands and ~500 words of personally-written
   feedback can be produced. Chipnet proof suffices.

Skip: Stablecoin Bridge (EVM day+), CashScript/BitauthIDE (subsumed by XO),
SolidCash, FoldingCash.

Submission window Nov 14–22 (deadline **Nov 22, 14:00 UTC**). Judging Nov 23–27.
Mainnet track requires: live demo link · ≥1 feature that sends a real BCH mainnet
tx · **WizardConnect** integration · Widget Factory presentation · public repo ·
Telegram check-in · ≥1 teammate at a prep/kick-off stream (roll call).

## Goal

Upgrade the capital path from **soft pledges to real PUSD/BCH
micro-commitments** — a significant-improvement entry, not a reskin. Investor
funds a pledge on BCH mainnet, the venture's public ledger renders the txid as
proof, and `fidelity` flips `soft → live` per commitment (not globally).

## Bounty map

| Bounty | Prize | Juakali angle | Status |
|---|---|---|---|
| Mainnet track | $3.5k/$1.5k/$750 PUSD | Judges send a real $1 PUSD pledge to a venture; ledger proves it | primary |
| Migrate to XO | 1 BCH ×5 | `commitments` (investor, venture, amount, shareBps, capMultiple, status) is already a contract spec — migrate the lifecycle to an XO template; tranche releases = follow-up actions | primary bounty |
| Decentralized Identity | $500 PUSD (Paytaca) | Venture self-sovereign identity: `bchAddress`↔`nostrPubkey` cryptographic binding; KPI check-ins as signed Nostr events = portable reputation (stretch) | strong |
| Build with XO | 0.3 BCH ×10 | Repayment-split covenant: venture repayment address auto-splits incoming payments x% to investor until `amount × capMultiple` | stretch |
| Stablecoin Bridge | $750 PUSD | Investor funds with USDC on Base → venture receives PUSD (route via existing swap provider; WalletConnect EVM side) | stretch |
| SolidCash | 3.5 BCH | Skip — no Solidity to port; XO covers the contract layer | skip |
| FoldingCash | 26M FLDCH | Skip the bounty; **steal the pattern** — merkle root of entitlements + pull claims is how pledge disbursement scales later | borrow pattern |
| Community Choice | $750 PUSD | EMBER2026 token voting — juakali is our strongest narrative | organic |
| Media track | $1,000 PUSD | winfactory/auteur viral piece about the venture ledger | optional |

Bounty rules allow one project to enter many bounties. XO bounties require
**~500 words of personally-written feedback — AI text rejected** (write it
yourself, keep notes while building).

## Architecture decision — two layers, per-field ownership

Chain is a settlement + proof layer, not a database. Convex stays the system of
record. Per-field truth:

- **Chain owns**: settlement status (funded/repaid derives from chain reads via
  Chaingraph/Fulcrum — Convex caches, never claims), identity binding proof,
  covenant state.
- **Convex owns**: everything else — KPI detail, notes, photos, emails, runs,
  digests, corrections/disputes (`correctionOf`, `disputeState` already exist —
  chain can't be edited, the off-chain ledger absorbs that reality).
- **Nostr carries**: signed attestations + identity announcements — the
  venture's portable reputation that survives juakali-the-company.
- **Anchors are one-way**: chain commits to the off-chain record (hashes only,
  never private content); the record never waits on the chain.

### Adoption gradient (long-term)

```
Soft pledge (today) → Assisted (sponsored venture address, Paytaca onboarding)
                    → Self-custody
```

On-chain settlement is an **upgrade path per commitment, not a migration of the
product**. Ventures without wallets stay soft; a commitment can upgrade when
both sides are ready. `FidelityMode` already models this — `live` becomes a
per-commitment property surfaced on the fidelity badge, not a global flip.

Real bottleneck is KES/M-PESA ↔ PUSD liquidity (off-ramp partner), not wallet
UX — flag honestly in the submission narrative.

## Schema changes (additive, optional — no migration)

- `ventures`: `bchAddress`, `nostrPubkey`, `identityProof` (binding signature + Nostr event id)
- `commitments`: `settlementAsset` ("bch" | "pusd" | "soft"), `pledgeTxid`, `fundedAt`, `repaidTotal`, `settlementAddress` (venture's receiving addr at pledge time)
- `ledgerEvents`: `txid`, `onchainRef` (explorer link data)
- `kpiCheckIns`: `nostrEventId` (when published as signed attestation)

## Steps

- [x] Schema fields + deploy (additive only)
- [x] `lib/bch/` in apps/default: address validation, tx build (libauth),
      explorer link helper (blockexplorer.cash, chipnet path aware)
- [x] WizardConnect: `@wizardconnect/react` — `useWizardConnect` wrapper hook
      (`use-bch-wallet.ts`) + QR (`bch-qr.web.tsx` AlphanumericQRCode; native
      shows URI fallback — libauth WASM means funding is web-only this slice)
- [x] Chipnet E2E: Cashonize via WizardConnect → faucet tBCH → sign →
      broadcast → txid `968684c9…437f55` verified on blockexplorer.cash/chipnet
- [x] Pledge funding flow: connect → construct send (venture `bchAddress`,
      PUSD if token-aware else BCH) → wallet signs → broadcast →
      `recordPledgeFunding` mutation (txid) → ledger event `onchainRef`
- [x] Ledger UI: `OnchainSeal` txid capsule (brass mainnet / cool chipnet) in
      proof-screen evidence slab, ledger detail, and chain-dot pip on rows;
      `SettlementRail` journey stepper on the fund card; scorecard notes
      "capital settled on-chain"; fidelity badge stays `soft` until
      per-commitment `live` is wired
- [x] Repayment recorder on the fund card (txid + sats → `recordRepayment`)
      — completes the rail's fourth stage for the demo
- [x] PUSD token outputs in `buildPledgeSpend` — token-category UTXO
      selection, `token` field on recipient/change outputs, excess-token
      change, foreign-token UTXOs never selected (would burn them), fee bump
      for token prefix bytes; unit-verified offline. Gate: set
      `EXPO_PUBLIC_BCH_PLEDGE_TOKEN` (category hex). Still needed: the real
      PUSD category ID, a KES→PUSD amount decision, and a broadcast test
- [x] Per-commitment fidelity: brass settled-dot on deal strip chips when
      `pledgeTxid` exists — soft vs settled is now visible at list level,
      derived from real fields (global badge stays `soft` — the capital path
      default is still soft pledges)
- [x] Venture identity: `bchAddress` + `nostrPubkey` fields, binding proof —
      OP_RETURN on-chain npub commitment (wallet-signed tx) ↔ signed Nostr
      event carrying address + txid (docs/bch-blaze-identity.md). Independently
      verifiable on explorer + any relay; no centralized provider.
- [ ] KPI→Nostr attestations on `third_party`-verified check-ins
      (`kpiCheckIns.nostrEventId` field exists; publish step pending)
- [ ] XO pledge template (Migrate bounty): tranche covenant on Chipnet, debug
      with blaze.xo.cash, submit invitation + 500-word personal feedback
- [ ] Widget Factory presentation + DoraHacks submission + Telegram check-in
- [ ] Stretch: repayment-split covenant (Build with XO), USDC→PUSD ramp
      (Bridge bounty)

## Demo script (judges)

1. Open live link → venture page → "Fund this venture"
2. Judge connects Paytaca/Selene via WizardConnect QR
3. Sends $1 PUSD (or small BCH) to venture address → real mainnet tx
4. Ledger updates with txid + explorer link; fidelity badge flips `live`
5. Optional: judge verifies venture's Nostr↔BCH binding independently

## Risks

- **Registration**: reportedly closed Nov 13 — confirm status before building.
- **Stream attendance**: roll-call requirement — verify we attended/attend a
  remaining stream.
- **XO feasibility**: stack is pre-release (`0.1.0-next.x`); keep the mainnet
  demo independent of XO success — simple BCH/PUSD send is the floor, XO is
  upside. Coordinate with GP Telegram early on feasibility.
- **PUSD token plumbing**: CashToken-aware tx building on mainnet needs PUSD
  category ID + BCMR metadata; plain BCH send satisfies the track requirement —
  PUSD is sponsor-pleasing bonus.
- **Legal framing**: keep "patronage/transparent gift pledges with public
  ledger" copy — not an investment contract. Small amounts only.
- **WizardConnect on Expo web**: QR + `wiz://` deep link both needed; test on
  the Netlify deploy early, not localhost.
