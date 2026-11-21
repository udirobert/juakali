# BCH BLAZE 2026 — Mainnet Take Runbook

One-shot mainnet demo. The investor wallet holds ~150k sats of real BCH;
there is no reload. This runbook exists because every step below was already
rehearsed on chipnet — the mainnet take is the same choreography with the
network flag flipped.

## Verified in advance (do not skip re-checking on the day)

- Tx builder dry-ran against the exact expected inputs: 150k → 100k pledge,
  228-sat fee, ~49.8k change; dust-folding edges and insufficient-balance
  throws all behave.
- `bitcoincash:qzm303qm73dtsk0h2wj72lqfgq5llj7lk5n48v5z4e` is the *corrected*
  venture receive address (`juakali-test` in Cashonize, seed backed up). An
  earlier transcription had a bad checksum — always copy the address from
  Cashonize, never retype it.
- mainnet-js's default Fulcrum (blackie.c3-soft.com) is alive; `electrum()`
  now probes a 5-server candidate list and picks the first responder.
- Paytaca supports WizardConnect hdwalletv1 (Riften Labs docs, Android/iOS/
  browser). Pairing must still be verified live before funds move — path
  names ("receive"/"change") are assumed identical to Cashonize.
- `recordPledgeFunding` is idempotent; the UI never re-signs after a
  successful broadcast (re-index retry only).
- `handleBind` rejects addresses that don't match the build's network.

## Roles

| Role | Wallet | Why |
|---|---|---|
| Investor | Paytaca (phone) | Sponsor's wallet, signs the pledge via WizardConnect QR |
| Venture | `juakali-test` in Cashonize | Receives the pledge; later signs the identity OP_RETURN |
| Demo venture | Amina Sales Pod (`ms7bbkj3zyk4nz3hqyhm19ghdn8cbwdv`), commitment `k9749ws0bgwk0rm1zp517bs32x8jns9c` | Clean slate — keeps Brian's chipnet evidence intact |

## Pre-flight (before any funds move)

1. User holds ≥ ~110k sats in Paytaca (100k pledge + fee headroom).
2. Deploy the mainnet build: `EXPO_PUBLIC_BCH_NETWORK=mainnet expo export -p web`
   → netlify deploy → open juakaliapp.netlify.app, confirm the settlement
   badge reads **"mainnet · real BCH"**.
3. On the deal page, clear stale chipnet sessions: devtools →
   `localStorage.removeItem("juakali-wc-session")` → reload.
4. Confirm the browser session is logged in as the investor who owns
   `k9749ws0…` (`kn74mepq…`) — `recordPledgeFunding` asserts ownership.
5. Start the CDP screencast capture.

## The take

1. **Bind the address** — on Amina's deal card, paste
   `bitcoincash:qzm303qm73dtsk0h2wj72lqfgq5llj7lk5n48v5z4e` → "Bind settlement
   address". (Must happen on the mainnet build — validation rejects prefixes
   that don't match.)
2. **Pair** — "Connect wallet" → QR → scan in Paytaca → approve. Watch the
   scan populate: it must show ≥ ~110k sats across the wallet's UTXOs.
   - *If Paytaca pairs but the scan stays empty*: the wallet's hdwalletv1
     path names differ → **fallback**: disconnect, create/use a second
     Cashonize wallet as investor, user sends Paytaca → that wallet's address
     (one plain wallet send), re-pair, continue.
   - *If Paytaca can't scan/pair at all*: same fallback — Cashonize is the
     reference WizardConnect wallet and satisfies the track requirement.
3. **Pledge** — enter `100000` → "Fund this pledge on BCH" → Paytaca shows
   the decoded tx (100k to the venture + change + ~230-sat fee) → approve →
   broadcast → "Pledge funded on-chain" seal.
   - *Abort criteria*: any wallet-side rejection or "insufficient" error →
     STOP, diagnose, do not retry blindly. A broadcast that succeeded but
     failed indexing shows the txid — retry is index-only, safe to press again.
4. **Receipt** — "Shareable receipt →" → the sealed poster card → screenshot
   (this is the social artifact).
5. **Explorer** — open the txid link → blockexplorer.cash shows the tx
   (mempool in seconds; allow 10–30s, refresh once).
6. **Identity bind (second tx)** — disconnect Paytaca → "connect a wallet" in
   the identity section → pair Cashonize `juakali-test` → "Bind Nostr
   identity" → sign (~230-sat fee, paid from the pledge output just
   received) → OP_RETURN tx + Nostr event + "self-sovereign" badge.
   - The venture wallet's pledge UTXO may still be unconfirmed — spending an
     unconfirmed parent is fine; if the scan doesn't see it yet, wait for one
     confirmation and rescan.

## Post-take

1. Update `docs/bch-blaze-submission.md`: mainnet funding txid + explorer URL,
   identity binding txid + Nostr event id.
2. Receipt URL: `https://juakaliapp.netlify.app/receipt/k9749ws0bgwk0rm1zp517bs32x8jns9c`
3. Cut the screencast frames into the demo loop.
4. Leave the deployed build on mainnet — it is the honest production state;
   chipnet receipts keep working (network is recorded per-commitment).

## Failure-mode cheatsheet

| Symptom | Likely cause | Move |
|---|---|---|
| Scan hangs >15s | Fulcrum unreachable | Probe failover should have caught it; reload once, then check candidate servers |
| "Insufficient balance" | Scan stale / wrong wallet / pledge > balance | Rescan; verify the funded wallet is the paired one |
| Wallet rejects sign | Serialization edge | Read the error verbatim; do not retry the same build |
| Broadcast ok, index fails | Convex blip | Press Fund again — it re-indexes the same txid, no re-sign |
| "already has a funding tx" | Same | Expected idempotency — refresh; the seal is already live |
| Mempool rejection code 66 | Fee < 1 sat/B | Not possible at 228–231 sats on a ~230-byte tx — investigate, don't bump blindly |
