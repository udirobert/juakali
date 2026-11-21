# BCH BLAZE 2026 — Widget Factory presentation (JuaKali)

Paste-ready copy for the official Widget Factory Google Slides template
(7 slides). Keep each slide to the template's layout; the em-dash bullets map
to its nested-bullet style.

> Links to add: live demo `https://juakaliapp.netlify.app` ·
> repo `https://github.com/udirobert/juakali` ·
> chipnet funding tx `968684c9cda561a24333336894de49e0e56d9c97e6e40170aead437b00437f55`
> · mainnet tx (fill in after the mainnet demo run).

---

## Slide 1 — Title

**JuaKali — Invest in Public**

juakali.app · juakaliapp.netlify.app

Team: Udi Robert (@udirobert)

## Slide 2 — Tagline

**Invest in Public!**

Soft revenue-share pledges into Kenya's informal-sector ventures — mentored by
an AI agent, proven by hard KPIs, sealed on Bitcoin Cash.

https://github.com/udirobert/juakali

## Slide 3 — The Story of JuaKali

www.bchblaze.cash

Kenya's "Jua Kali" sector — welders, tailors, kiosk apprentices — runs on trust
and hustle but has no verifiable track record. Busy investors want to back
them but can't see the work.

We asked: what if the mentoring itself produced the proof? An AI agent mentors
each venture, logs hard KPIs, and publishes a transparent public ledger.
For BLAZE we closed the last mile — the pledge itself now settles on BCH:
wallet-funded, wallet-signed, and rendered as a txid on the same public page.

## Slide 4 — Benefits of JuaKali

* Soft pledges become real micro-commitments
  * Investors fund pledges in BCH (PUSD-ready) through a WizardConnect wallet
  * Fidelity flips soft → live per commitment only when the tx confirms
* Hard KPIs instead of vibes
  * Agent-recorded check-ins (revenue, jobs, meetings) with evidence tags
  * Investor approves each agent run — human stays in the loop
* A public ledger anyone can audit
  * Capital → agent actions → KPI results on one page
  * Funding and repayment txids link straight to blockexplorer.cash
  * Chain is the source of truth; the ledger only caches what it proved
* Honest by construction
  * Soft pledges are patronage, not securities, escrow, or investment contracts

## Slide 5 — BCH Usage

JuaKali's deal cockpit carries an on-chain settlement rail:

* WizardConnect (hdwalletv1) wallet connection
  * Dapp derives investor receive/change addresses from shared xpubs
  * Electrum scan finds spendable UTXOs; unsigned tx built locally
  * Wallet signs — keys never leave the wallet; dapp broadcasts
* Settlement proofs on the public ledger
  * recordPledgeFunding anchors the funding txid to the commitment
  * Repayment txids anchor the return leg of the revenue share
* Proven end-to-end on chipnet; mainnet demo included in the submission
* Optional PUSD CashToken output on the pledge spend (verified category)

## Slide 6 — The Vision for JuaKali

* The revenue-share contract, native on BCH
  * XO covenant: venture repayments auto-split shareBps to the investor
    until amount × capMultiple — programmable, inspectable settlement
* Portable venture reputation
  * KPI check-ins as signed Nostr attestations on the venture's own key
  * Reputation survives JuaKali-the-company
* One-step global funding
  * USDC → PUSD bridge so any investor can fund a pledge in one move
* Target: every informal-sector apprentice has an investable public record

## Slide 7 — Thank You!

THANK YOU!

Live demo: https://juakaliapp.netlify.app
Code: https://github.com/udirobert/juakali
Chipnet funding tx: 968684c9…437f55 (blockexplorer.cash/chipnet)
Mainnet funding tx: <fill after mainnet demo>
