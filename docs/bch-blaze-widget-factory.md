# BCH BLAZE 2026 — Widget Factory presentation (JuaKali)

Paste-ready copy for the official Widget Factory Google Slides template
(7 slides). Keep each slide to the template's layout; the em-dash bullets map
to its nested-bullet style.

Template (official, not our deck — copy it first):
https://docs.google.com/presentation/d/1Yfuk9CJkf4U9M_WukcELhumWgj3Ak6345Ewy8hSp-Hk/edit?usp=sharing

> Links to add: live demo `https://juakaliapp.netlify.app` ·
> repo `https://github.com/udirobert/juakali` ·
> chipnet funding tx `968684c9cda561a24333336894de49e0e56d9c97e6e40170aead437b00437f55`
> · ledger API `https://zealous-scorpion-285.convex.site/api/ledger?limit=15`
>
> **Not supplied, do not claim:** a mainnet tx, a published deck link, a video.
> Evidence on these slides is the recorded chipnet record — judges can inspect
> it without signing in, connecting a wallet, or sending anything.

---

## Slide 1 — Title

**JuaKali — Invest in Public**

juakaliapp.netlify.app

Team: Udi Robert (@udirobert)

## Slide 2 — Tagline

**Invest in Public!**

Soft revenue-share pledges into Kenya's informal-sector ventures — mentored by
an AI agent, KPIs logged with evidence tags, settlement proofs on Bitcoin Cash.

https://github.com/udirobert/juakali

## Slide 3 — The Story of JuaKali

www.bchblaze.cash

Kenya's "Jua Kali" sector — welders, tailors, kiosk apprentices — runs on trust
and hustle but rarely produces records investors can inspect. Busy investors
want to back them but can't see the work.

We asked: what if the mentoring itself produced the record? An AI agent mentors
each venture, logs KPIs (founder-reported, tagged with the evidence claimed),
and publishes a transparent public ledger. For BLAZE we closed the last mile —
the pledge now has an optional on-chain settlement rail: wallet-connected,
wallet-signed, and rendered as a txid on the same public page.

## Slide 4 — Benefits of JuaKali

* Soft pledges can become real micro-commitments
  * Investors may fund a pledge in BCH through a WizardConnect wallet —
    a separate opt-in; a soft pledge itself moves no money
  * Fidelity shows soft → live per commitment alongside the recorded txid
* KPIs with honest evidence labels
  * Founder-reported check-ins (revenue, jobs, meetings); tags mark what was
    claimed — nothing is labelled verified that wasn't
  * Consequential agent writes go through an approval gate before publishing
* A public ledger anyone can audit
  * Capital → agent actions → results on one page; a JSON API serves the
    same records
  * Funding and repayment txids link straight to blockexplorer.cash
  * A txid is an auditable pointer — the app never claims settlement for you
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
* Proven end-to-end on **chipnet** — the funding tx is inspectable today via
  the ledger API and blockexplorer.cash; a documented mainnet runbook exists
  for an explicit owner decision
* PUSD CashToken output on the pledge spend is implemented; no mainnet PUSD
  proof is supplied

## Slide 6 — The Vision for JuaKali

Roadmap — not submitted features. What IS shipped: the BCH↔Nostr identity
binding recorded on chipnet (tx + signed event in the submission evidence).
The rest is direction:

* The revenue-share contract, native on BCH
  * XO covenant: venture repayments auto-split shareBps to the investor
    until amount × capMultiple — programmable, inspectable settlement
* Portable venture reputation
  * KPI check-ins as signed Nostr attestations on the venture's own key
    (planned — the shipped piece today is the BCH↔Nostr identity binding)
  * Reputation survives JuaKali-the-company
* One-step global funding
  * USDC → PUSD bridge so any investor can fund a pledge in one move
* Target: every informal-sector apprentice has an investable public record

## Slide 7 — Thank You!

THANK YOU!

Live demo: https://juakaliapp.netlify.app
Public ledger: https://juakaliapp.netlify.app/share/ledger
Code: https://github.com/udirobert/juakali
Chipnet funding tx: 968684c9…437f55 (blockexplorer.cash/chipnet)
Ledger API: https://zealous-scorpion-285.convex.site/api/ledger?limit=15
