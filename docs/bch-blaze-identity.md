# JuaKali — BCH ↔ Nostr Venture Identity

Decentralized Identity bounty (Paytaca, $500 PUSD): self-sovereign identity that
cryptographically links a Bitcoin Cash address to a Nostr identity — no
centralized provider, independently verifiable.

## Protocol

A venture's identity is two cryptographic keys it controls:

- **BCH key** — the wallet key behind the venture's settlement `bchAddress`
  (Cashonize / Paytaca / any BCH wallet).
- **Nostr key** — a secp256k1 keypair generated for the venture
  (`lib/nostr/identity.ts`). For this PoC the secret stays in the client's
  local storage; production custody is with the venture owner.

Binding is a **two-way proof** — neither side trusts the other, and a
third party can verify both:

1. **BCH → Nostr (on-chain commitment).** The connected wallet signs and
   broadcasts a transaction with an `OP_RETURN` output containing
   `juakali:identity:<npub>` — `buildIdentitySpend` in `lib/bch/tx.ts`. The
   bound BCH identity is the **funding wallet's own address** (a verifier
   checks the tx inputs), so binding a venture means connecting *its*
   wallet. Signing power over the BCH key is proven by the transaction
   existing; the commitment is timestamped on-chain. (Also satisfies the
   stretch goal "BCH transactions used as identity commitments.")
2. **Nostr → BCH (signed attestation).** The venture's Nostr key signs a
   kind-1 event (tags: `bch` address, `bch-network`, `bch-binding-tx`,
   `t: juakali-identity`) naming the BCH address and the binding txid,
   published to public relays (`relay.damus.io`, `nos.lol`,
   `relay.nostr.band`). Publishing requires the Nostr secret key.

## Independent verification (no JuaKali infrastructure)

1. Fetch the event by the venture's `npub` from any relay —
   `fetchBindingEvent(pubkey)` in `lib/nostr/identity.ts`, or any Nostr client:
   `{"kinds":[1],"authors":["<npub-hex>"],"#t":["juakali-identity"]}`.
2. Verify the Schnorr signature (`verifyEvent`, nostr-tools / any NIP-01
   client) — proves the event was signed by the claimed Nostr key.
3. Read `bch` and `bch-binding-tx` tags. Open the txid on any BCH explorer
   (blockexplorer.cash) and read the `OP_RETURN` output — it must equal
   `juakali:identity:<same npub>`. Proves the BCH key's owner committed to
   that npub.
4. The BCH address in the event must match the address that *funded* the
   binding tx — confirms both proofs describe the same identity.

A challenger can additionally issue a challenge-response: ask the identity
holder to sign a nonce event with the Nostr key or a fresh tx/address proof
from the BCH key. `verifyBindingEvent` covers step 2–3 in code.

## What JuaKali stores

`ventures.nostrPubkey` and `ventures.identityProof { bchSignature: <binding
txid>, nostrEventId, boundAt }` (schema.ts) — a **cache** of the binding for
product display only. Verification never reads it.

KPI check-ins publish as signed Nostr attestations under the same venture
key, recorded in `kpiCheckIns.nostrEventId` — portable reputation that
follows the venture's npub across applications (stretch goal).

## Status

- [x] Binding tx construction (OP_RETURN, token-safe — plain UTXOs only)
- [x] Two-way proof flow in the deal UI (`fund-on-bch.tsx` → "Bind Nostr identity")
- [x] `bindVentureIdentity` mutation caches the proof
- [x] Relay publish + independent fetch/verify helpers
- [ ] KPI→Nostr attestation publishing (stretch, wired field exists)
- [ ] Key rotation/recovery (stretch — explicitly rejected on rebind today)

## Live proof (chipnet, 2026-11-21)

Binding run end-to-end through WizardConnect → Cashonize sign → broadcast:

| Proof | Value | Verify |
|---|---|---|
| Venture npub | `npub17yk5…` (`f12d4640…301d`) | relays |
| Binding txid | `61dfba79019d82814b9a808a8cb8c63fce631541b8f2a59238888411c1dd0486` | `blockexplorer.cash/chipnet/tx/61dfba79…` — OP_RETURN `juakali:identity:npub17yk5…` |
| Nostr event | `ff23e872e9fcbce517bc237051226dff305b85f1c5d949c6b330d7a41a3c36d0` | `njump.me/ff23e872…` — sig verified under `f12d4640…`, tags carry address + txid |
| Bound address | `bchtest:qpmtdtxye6tedurrc6z8wjh9a00ya70fxglf0za93c` | tx input address (venture wallet `venture-brian`) |

Independently verified 2026-11-21: event fetched from `relay.damus.io`,
`verifyEvent` passed; OP_RETURN read on the public explorer.
