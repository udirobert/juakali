# Tari Ootle — November "MVP!" Build Contest

## Status: scoped — not started. Sequenced behind BCH Blaze (Nov 22 14:00 UTC), then ~8 days to the Dec 1 cutoff.

> **No rules conflict with BCH Blaze.** Both contests can be entered with the same
> product: Blaze allows one project across many bounties, and Tari asks for *new
> code written after the November announcement* (a new repo, or a new
> contract/library consumed by an existing app) — the separate `tari-revshare`
> MIT repo satisfies that. The only reason this is sequenced rather than
> parallel is bandwidth and the Blaze deadline, not eligibility. The two
> windows barely overlap anyway: Blaze closes Nov 22 and judges Nov 23–27,
> Tari closes Dec 1.

## Contest context

Tari community Ootle launch series. November theme: **MVP!** — a product that
could go to market today and start finding users.

- **Deadline: Dec 1 00:00 UTC.** One post in the November thread
  (community.tari.com/t/520).
- New repo with new code written after the November announcement. A new smart
  contract or library *consumed by* an existing project qualifies (Fox,
  Oct thread) — the contract carries the submission; the app around it may
  predate the month.
- May build on **any** prior contest submission's OSS code (Sept + Oct) —
  substantive riffs only, minor tweaks get discounted.
- OSI license required — use **MIT**. Agent-written code explicitly allowed;
  code quality is judged.
- Submission needs: public code link · **link to the MVP app** · description ·
  Tari payment address · announcement post on **Bluesky / Reddit / Medium /
  YouTube** (X does not count).
- Prizes: 1M / 500K / 250K XTM. First-to-launch bonus (100K XTM, first 20
  mainnet contracts) cut off Nov 21 — **missed**.
- Prior submissions for shape: Ootle Pay (stake-gated payment gateway),
  ShadowTix (NFT ticketing), Legacy Vault (dead-man's switch), Phantom Drop
  (stealth claim links), Crypt (sell-a-secret), Ghostline (pay-per-call for
  AI agents), Sapient (`window.tari` browser wallet — reusable).

## Concept: `RevenueShareCommitment` template

**Soft pledges → confidential funded commitments.** Investor funds a
confidential XTM vault bound to a venture identity; repayments auto-route
`shareBps` to the investor until `amount × capMultiple`, then the commitment
closes.

Why this and not something new:

- `commitments` is already a contract spec. The Convex schema *is* the
  interface: investor, venture, `amount`, `shareBps`, `capMultiple`, `status`,
  `repaidTotal`. The BCH plan said it for XO — Ootle vaults make the split
  natural where BCH covenants made it awkward.
- The repayment-split covenant was the XO stretch item in the Blaze map. This
  is where it lands.
- Confidential amounts + public attestation extends the existing per-field
  ownership split: chain carries proofs/hashes, Convex carries content.
  Investor positions and venture revenue stay private; ledger attestations
  stay public — "invest in public" survives on a privacy chain.
- Narrative: a South-African-built chain settling commitments into Kenyan
  Jua Kali ventures. The council will notice.

## Template interface sketch

Verify every signature against **tari-ootle v0.50+** — Esmeralda was reset
Nov 2 and templates built on the old metadata format no longer load.

```rust
// State (component)
terms: { share_bps: u32, cap_multiple: u32 },   // mirrors commitments row
funded: Vault,            // investor's XTM deposit (confidential)
investor_bucket: Vault,   // accrued share, pull-claim (FoldingCash pattern)
venture: ComponentAddress / identity binding,
repaid_total: Amount,
status: Proposed | Funded | Repaying | Closed,

// Methods
propose(terms, venture_id)                    // investor or venture creates
fund(bucket)                                  // investor deposits → Funded
repay(bucket)                                 // anyone routes venture revenue:
                                              //   to_investor = min(bps cut, remaining_cap)
                                              //   remainder → venture vault
                                              //   cap reached → Closed
claim()                                       // investor pulls accrued share
close()                                       // mutual / expiry path
```

- Investor claim uses the **pull pattern** (merkle root of entitlements +
  pull claims) already noted in the Blaze map — disbursement scales.
- Stretch: deliver a funded commitment to an investor as a **claim link**
  (Phantom Drop riff — allowed this month).

## Integration (keep thin — the contract carries the entry)

- `commitments.settlementAsset`: add `"xtm"` variant; `settlementNetwork`:
  add `"esmeralda"`/`"mainnet"` values (additive-optional, same pattern as BCH).
- `FundOnTariCard` beside `FundOnBchCard` in the deal cockpit — **web-only**
  is acceptable (BCH funding is already web-only this slice).
- Wallet side: integrate against **Sapient** (`window.tari` provider, Sept
  submission, OSS) or the tari wallet daemon — building on prior submissions
  is the sanctioned path.
- Ledger: `onchainRef` renders the Ootle proof link; fidelity badge flips
  `soft → live` per commitment, same rule as BCH (chain owns settlement,
  Convex caches).

## Repo & licensing

- **New repo** `tari-revshare` (or `juakali-ootle`), **MIT** from day one.
  JuaKali consumes it; the submission links the new repo + the live app.
- JuaKali itself still has **no LICENSE file** — add one (hygiene item, not
  strictly required for the entry since the contract lives in the new repo).

## Steps

- [ ] Confirm template toolchain on v0.50: `cargo generate` template →
      wasm32-unknown-unknown → publish to Esmeralda via tari CLI
- [ ] `RevenueShareCommitment` template + unit tests (split math, cap,
      claim, close edge cases — judges read these)
- [ ] Deploy to Esmeralda; record template address + tx
- [ ] `settlementAsset: "xtm"` schema variant + `FundOnTariCard` (web)
- [ ] Investor claim flow against Sapient or wallet daemon
- [ ] Ledger `onchainRef` for Ootle explorer
- [ ] Public repo + MIT + README (description judges will skim)
- [ ] Announcement post (Bluesky or Reddit — pick before Dec 1)
- [ ] Forum submission post: code link · app link · description · Tari
      payment address · announcement link — **before Dec 1 00:00 UTC**

## Demo script (judges)

1. Open live JuaKali → deal cockpit → "Fund on Tari"
2. Investor signs via Sapient/`window.tari` → commitment vault funded on
   Esmeralda → fidelity flips `live` on that deal only
3. Record a repayment → watch the split route `shareBps` to the investor
   bucket; ledger shows the proof link
4. Investor claims; cap reached → `Closed`
5. Point at the public repo: template + tests

## Risks

- **Bandwidth.** Blaze submission closes Nov 22; that leaves ~8 days and a
  Rust/WASM toolchain this repo has never used. The contract is small
  (~a few hundred lines) but toolchain-first-day is real — spike a hello-world
  template publish on Nov 22 before committing.
- **Judging context.** Ootle Pay, Phantom Drop, and Ghostline already cover
  payments/claim-links/agent-payments. The differentiator is the
  revenue-share lifecycle + live consumer product — say so plainly in the
  submission post.
- **Esmeralda churn.** A second reset or another metadata-format bump
  mid-week would cost a day; track the dev channel.
- **Narrative tension.** "Invest in public" vs confidential settlement —
  resolve the same way as BCH: chain carries proofs/hashes, the public
  ledger carries attestations. Put that sentence in the submission.
- **Contest stack.** JuaKali is concurrently in Gemini X Prize + BCH Blaze +
  Tari Ootle. Nothing in either rule set forbids that — the constraint is
  attention, not eligibility. Blaze closes Nov 22 14:00 UTC; after that,
  Tari is the only active build. Do not start the Tari repo before the Blaze
  submission is in.
