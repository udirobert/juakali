# BCH BLAZE 2026 — DoraHacks submission draft

Paste-ready fields for https://dorahacks.io/hackathon/bchblaze2026.
Deadline: **Nov 22, 2026 14:00 UTC**.

## Project name

JuaKali — Invest in Public

## Tagline

Soft revenue-share pledges into Kenya's informal-sector ventures — mentored by
an AI agent, proven by hard KPIs, sealed on Bitcoin Cash.

## Description (details field)

JuaKali turns informal venture backing into public, verifiable evidence.

Kenya's "Jua Kali" sector — welders, tailors, kiosk apprentices — runs on trust
but has no verifiable track record. Investors who want to back them can't see
the work. JuaKali pairs each venture with an AI mentor that logs hard KPIs
(revenue, jobs, meetings) and publishes a transparent public ledger:
capital → agent actions → results.

**What BLAZE added (all work Nov 14–22):** the pledge now settles on BCH.
In each deal cockpit, an on-chain settlement rail takes a commitment from soft
intent to funded on-chain: connect a wallet via WizardConnect (hdwalletv1),
the dapp scans receive/change xpubs over Electrum, builds the unsigned
transaction locally, the wallet signs (keys never leave the wallet), the dapp
broadcasts, and the funding txid is anchored to the commitment and rendered on
the public ledger with an explorer link. Chain is the source of truth; Convex
only caches what the chain proved. Repayment txids anchor the return leg.

Proven end-to-end on chipnet (tx `968684c9…437f55`) and mainnet (tx below).
PUSD CashToken output supported on the pledge spend (verified category).
Soft pledges remain patronage — not securities, escrow, or investment
contracts; `live` fidelity shows only once funding confirms on-chain.

## Links

- Live demo: https://juakaliapp.netlify.app
- Repo (public): https://github.com/udirobert/juakali
- Presentation (Widget Factory): <Google Slides link + PDF in repo>
- Public ledger: https://juakaliapp.netlify.app/share/ledger
- Embeddable widget: https://zealous-scorpion-285.convex.site/embed.js

## Track & bounties

- Mainnet track — primary
- Community Choice — organic (EMBER2026 receive address: add CashToken addr)
- Decentralized Identity — only if BCH↔Nostr binding ships before deadline
- Build with XO / Migrate to XO — only if the covenant template ships; feedback
  must be ~500 words personally written (AI rejected)

## On-chain evidence

- Chipnet funding tx (100,000 sats, JuaKali → venture):
  `968684c9cda561a24333336894de49e0e56d9c97e6e40170aead437b00437f55`
  https://blockexplorer.cash/chipnet/tx/968684c9cda561a24333336894de49e0e56d9c97e6e40170aead437b00437f55
- Mainnet funding tx: <fill after mainnet demo>
- Faucet funding tx (chipnet): `91c7d036f3c7b6ceeecf0e9939e1c4141fca1f16f19ab5914e864007459320e8`

## Work window evidence

- Last pre-BLAZE commit: `2b7a5b4` (Sep 22) — tag `pre-blaze-1114`
- BLAZE commits land Nov 18–22: settlement layer (`4b447ee`), deploy+docs
  fixes (`c527f28`), WizardConnect E2E fixes (`e5f63c4`), + submission docs

## Telegram check-in (@bchblaze)

> Checking in for BLAZE 2026 — JuaKali (Invest in Public): soft revenue-share
> pledges into Kenyan informal-sector ventures, mentored by an AI agent and
> settled on BCH via WizardConnect. Live demo juakaliapp.netlify.app,
> public repo github.com/udirobert/juakali. DoraHacks: <username>

## Judge try-it path

1. Open https://juakaliapp.netlify.app → demo sign-in
2. Deals → Brian Welding Bench → On-chain settlement card
3. Connect BCH wallet (WizardConnect QR — Selene/Paytaca/Cashonize)
4. Enter sats → Fund this pledge on BCH → approve in wallet
5. Watch the rail flip to funded on-chain; click the txid → explorer
6. Public ledger: /share/ledger shows the anchored tx
