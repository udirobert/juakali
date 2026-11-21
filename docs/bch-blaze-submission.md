# BCH BLAZE 2026 — DoraHacks submission draft

Deadline: **Nov 22, 2026 14:00 UTC** — see https://bchblaze.cash/schedule/
and https://dorahacks.io/hackathon/bchblaze2026. Registration closed Nov 13
per the organizer — owner must confirm our entry is registered before relying
on this draft.

Sections are labelled **PASTE-READY** (safe for judge-facing fields) or
**INTERNAL** (checklist/draft — do not paste verbatim).

---

## PASTE-READY: Project name

JuaKali — Invest in Public

## PASTE-READY: Tagline

Soft revenue-share pledges into Kenya's informal-sector ventures — mentored by
an AI agent, KPIs logged with evidence tags, settlement proofs on Bitcoin Cash.

## PASTE-READY: Description (details field)

JuaKali turns informal venture backing into public, inspectable evidence.

Kenya's "Jua Kali" sector — welders, tailors, kiosk apprentices — runs on trust
but rarely produces records investors can inspect. Investors who want to back
them can't see the work. JuaKali pairs each venture with an AI mentor that logs KPIs
(revenue, jobs, meetings — founder-reported, tagged with what evidence was
claimed) and publishes a transparent public ledger: capital → agent actions →
results.

**What BLAZE added (work in this window):** the pledge now has an on-chain
settlement path. In each deal cockpit, an on-chain settlement rail takes a
commitment from soft intent to funded on-chain: connect a wallet via
WizardConnect (hdwalletv1), the dapp scans receive/change xpubs over Electrum,
builds the unsigned transaction locally, the wallet signs (keys never leave
the wallet), the dapp broadcasts, and the funding txid is anchored to the
commitment and rendered on the public ledger with an explorer link. A recorded
txid is an auditable pointer anyone can inspect — independent of the venture's
self-reported numbers.

Why BCH: an optional wallet-signed transfer gives both parties an auditable
pointer to the capital leg that is separate from self-reported work. Soft
pledges themselves never move money — neither do the private founder check-in
workspaces. A PUSD CashToken output on the pledge spend is implemented; no
mainnet PUSD proof is supplied with this submission.

Soft pledges remain patronage — not securities, escrow, or investment
contracts.

## PASTE-READY: On-chain evidence (chipnet)

Recorded on chipnet; inspectable via the ledger API and block explorer. These
are records from the build window — re-verify before citing as live state.

- Chipnet funding tx (100,000 sats, JuaKali → venture):
  `968684c9cda561a24333336894de49e0e56d9c97e6e40170aead437b00437f55`
  https://blockexplorer.cash/chipnet/tx/968684c9cda561a24333336894de49e0e56d9c97e6e40170aead437b00437f55
- Identity binding tx (OP_RETURN `juakali:identity:npub17yk5…`, venture wallet):
  `61dfba79019d82814b9a808a8cb8c63fce631541b8f2a59238888411c1dd0486`
  https://blockexplorer.cash/chipnet/tx/61dfba79019d82814b9a808a8cb8c63fce631541b8f2a59238888411c1dd0486
- Nostr binding event (signed under `f12d4640…`):
  `ff23e872e9fcbce517bc237051226dff305b85f1c5d949c6b330d7a41a3c36d0`
  https://njump.me/ff23e872e9fcbce517bc237051226dff305b85f1c5d949c6b330d7a41a3c36d0
- Faucet funding tx (chipnet): `91c7d036f3c7b6ceeecf0e9939e1c4141fca1f16f19ab5914e864007459320e8`
- Ledger API (public): https://zealous-scorpion-285.convex.site/api/ledger?limit=15
  — served the chipnet funding tx above when checked during doc prep.

## PASTE-READY: Links

- Live demo: https://juakaliapp.netlify.app
- Repo (public): https://github.com/udirobert/juakali
- Public ledger: https://juakaliapp.netlify.app/share/ledger
- Embeddable widget: https://zealous-scorpion-285.convex.site/embed.js

## PASTE-READY: Judge try-it path (no wallet, no money)

1. Open https://juakaliapp.netlify.app — the landing page is public.
2. Public ledger: https://juakaliapp.netlify.app/share/ledger — find the
   on-chain row and its txid link.
3. Ledger API: https://zealous-scorpion-285.convex.site/api/ledger?limit=15 —
   the same record as JSON.
4. Click the txid → blockexplorer.cash/chipnet — confirm the funding tx exists
   on-chain.
5. Optional: open a proof page (/proof/…) from a ledger row — the raw record
   fields are inspectable without signing in.

No sign-in, wallet connection, or transaction is required to inspect the
existing chipnet record. An owner-only mainnet runbook exists in the repo
(docs/bch-blaze-mainnet-runbook.md) and is used only after an explicit human
decision to broadcast on mainnet.

---

## INTERNAL — rules & package checklist (do not paste)

Mainnet track requirements per organizer (bchblaze.cash / DoraHacks):

- [ ] **Feature involving real mainnet BCH transactions** — the organizer's
      track requires mainnet capability; our own evidence gate before claiming
      anything is a verified mainnet txid. We have a recorded chipnet proof
      but **no mainnet tx yet**. The settlement network defaults to `chipnet`
      (`EXPO_PUBLIC_BCH_NETWORK`); the deployed build's network has not been
      re-verified — confirm before claiming any mainnet capability. The
      mainnet runbook (docs/bch-blaze-mainnet-runbook.md) exists; broadcasting
      is an explicit owner decision.
- [ ] Working live public demo — juakaliapp.netlify.app returned HTTP 200 at
      doc-prep time; that is an HTTP liveness check only, not a functional
      or mainnet claim.
- [ ] WizardConnect wallet funding — implemented in `apps/default/lib/bch/`.
- [ ] Short deck using the **official Widget Factory template**:
      https://docs.google.com/presentation/d/1Yfuk9CJkf4U9M_WukcELhumWgj3Ak6345Ewy8hSp-Hk/edit?usp=sharing
      (template only — our completed slides are not yet published).
      Slide copy is in docs/bch-blaze-widget-factory.md. **Owner must create
      and publish a viewable link** to the finished deck; no link exists yet.
- [ ] Prior project / body of work distinguished — tag `pre-blaze-1114`
      resolves to commit `2b7a5b4fe408ef770bb3fb0bfd103485d14e2b69`:
      https://github.com/udirobert/juakali/tree/pre-blaze-1114
      Compare vs main: https://github.com/udirobert/juakali/compare/pre-blaze-1114...main
      If judges want the prior app state, provide the archived demo link
      (none currently published — owner to supply if needed).
- [ ] **Decentralized Identity bounty** — eligible to review; two-way
      BCH↔Nostr binding shipped on chipnet (txids + event above), architecture
      in docs/bch-blaze-identity.md.
- [ ] **Stream attendance** — required per organizer; streams may already have
      finished. Owner to confirm past attendance or obtain an organizer
      ruling; not yet confirmed either way.
- [ ] **Telegram check-in** in @bchblaze — owner must post (draft below).
- [ ] **DoraHacks registration** — closed Nov 13; owner must confirm the
      account/entry exists before the deadline.
- [ ] Community Choice — optional; if participating, add the EMBER2026
      CashToken receive address (not yet supplied).
- [ ] Build with XO / Migrate to XO — optional; only claim if the covenant
      template actually ships in the submitted build. Any XO feedback must be
      ~500 words personally written by the owner — AI-generated feedback is
      rejected.

Work window evidence:

- Last pre-BLAZE commit: `2b7a5b4` — tag `pre-blaze-1114`
- BLAZE-window commits: settlement layer (`4b447ee`), deploy+docs fixes
  (`c527f28`), WizardConnect E2E fixes (`e5f63c4`), + submission docs

## INTERNAL — Telegram check-in draft (@bchblaze)

Fill `<DoraHacks username>` before posting:

> Checking in for BLAZE 2026 — JuaKali (Invest in Public): soft revenue-share
> pledges into Kenyan informal-sector ventures, mentored by an AI agent, with
> an optional BCH settlement rail via WizardConnect — proven on chipnet.
> Live demo juakaliapp.netlify.app, public repo github.com/udirobert/juakali.
> DoraHacks: <DoraHacks username>
