import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent, type Event as NostrEvent } from "nostr-tools";
import { nip19 } from "nostr-tools";
import { SimplePool } from "nostr-tools/pool";

/**
 * Venture self-sovereign identity (Decentralized Identity bounty).
 *
 * Binding proof = two verifiable halves, no custodian:
 *   BCH side  — an OP_RETURN output on a tx the wallet signs commits
 *               `juakali:identity:<npub>` from the bound address.
 *   Nostr side — a signed kind-1 event by the venture key naming the
 *               BCH address + binding txid (the reverse attestation).
 *
 * Third parties verify independently: fetch the event by npub on public
 * relays, check the Schnorr signature, then read the tx's OP_RETURN on any
 * BCH explorer and compare the npub. No JuaKali database involved.
 *
 * The venture's Nostr secret key lives in the app's local storage — in
 * production it would live with the venture owner (PoC scope per bounty:
 * "users hold their own keys").
 */

export const NOSTR_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band"];

const KEY_PREFIX = "juakali-nostr-key:";

export function ventureNostrKey(ventureId: string): { secretKey: Uint8Array; pubkey: string; npub: string } {
    const storageKey = `${KEY_PREFIX}${ventureId}`;
    let secretKey: Uint8Array;
    try {
        const stored = globalThis.localStorage?.getItem(storageKey);
        if (stored) {
            secretKey = Uint8Array.from(JSON.parse(stored) as number[]);
        } else {
            secretKey = generateSecretKey();
            globalThis.localStorage?.setItem(storageKey, JSON.stringify(Array.from(secretKey)));
        }
    } catch {
        secretKey = generateSecretKey();
    }
    const pubkey = getPublicKey(secretKey);
    return { secretKey, pubkey, npub: nip19.npubEncode(pubkey) };
}

/** OP_RETURN payload committed on-chain by the binding tx. */
export function bindingPayload(npub: string): Uint8Array {
    return new TextEncoder().encode(`juakali:identity:${npub}`);
}

/**
 * Publish the reverse attestation: a signed Nostr event naming the bound
 * BCH address and the txid whose OP_RETURN carries the npub.
 */
export async function publishBindingEvent(args: {
    secretKey: Uint8Array;
    bchAddress: string;
    bindingTxid: string;
    network: "chipnet" | "mainnet";
}): Promise<{ eventId: string; publishedTo: number }> {
    const event = finalizeEvent(
        {
            kind: 1,
            created_at: Math.floor(Date.now() / 1000),
            tags: [
                ["t", "juakali-identity"],
                ["bch", args.bchAddress],
                ["bch-network", args.network],
                ["bch-binding-tx", args.bindingTxid],
            ],
            content: JSON.stringify({
                type: "juakali-identity-binding",
                bchAddress: args.bchAddress,
                bchNetwork: args.network,
                bindingTxid: args.bindingTxid,
            }),
        },
        args.secretKey
    );
    const pool = new SimplePool();
    try {
        const results = await Promise.allSettled(pool.publish(NOSTR_RELAYS, event));
        const publishedTo = results.filter((r) => r.status === "fulfilled").length;
        if (publishedTo === 0) throw new Error("No relay accepted the binding event");
        return { eventId: event.id, publishedTo };
    } finally {
        pool.close(NOSTR_RELAYS);
    }
}

/** Fetch the latest binding event a pubkey has published — independent verification path. */
export async function fetchBindingEvent(pubkey: string): Promise<NostrEvent | null> {
    const pool = new SimplePool();
    try {
        const events = await pool.querySync(NOSTR_RELAYS, {
            kinds: [1],
            authors: [pubkey],
            "#t": ["juakali-identity"],
            limit: 5,
        });
        return events.sort((a, b) => b.created_at - a.created_at)[0] ?? null;
    } catch {
        return null;
    } finally {
        pool.close(NOSTR_RELAYS);
    }
}

/**
 * Independent verification: event signature valid under the claimed pubkey,
 * and the event's declared BCH address matches what we expect. The OP_RETURN
 * half is checked on-chain via the explorer (documented in
 * docs/bch-blaze-identity.md).
 */
export function verifyBindingEvent(event: NostrEvent, expectedPubkey: string): {
    valid: boolean;
    bchAddress: string | null;
    bindingTxid: string | null;
} {
    if (event.pubkey !== expectedPubkey || !verifyEvent(event)) {
        return { valid: false, bchAddress: null, bindingTxid: null };
    }
    const tag = (n: string) => event.tags.find((t) => t[0] === n)?.[1] ?? null;
    return { valid: true, bchAddress: tag("bch"), bindingTxid: tag("bch-binding-tx") };
}
