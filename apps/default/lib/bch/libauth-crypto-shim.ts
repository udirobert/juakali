/**
 * Metro-compatible replacement for @bitauth/libauth's
 * `crypto/default-crypto-instances.js`.
 *
 * Upstream instantiates its WASM crypto modules with top-level await, which
 * Metro cannot parse. This shim exports the same live bindings but lazily —
 * call `await ensureBchCrypto()` once (before wallet connect / key
 * derivation / hashing) and every importer sees the initialized instances
 * through ES-module live bindings.
 *
 * Wired in apps/default/metro.config.js via resolver.resolveRequest.
 */
import { instantiateRipemd160 } from "@bitauth/libauth/build/lib/crypto/ripemd160.js";
import { instantiateSecp256k1 } from "@bitauth/libauth/build/lib/crypto/secp256k1.js";
import { instantiateSha1 } from "@bitauth/libauth/build/lib/crypto/sha1.js";
import { instantiateSha256 } from "@bitauth/libauth/build/lib/crypto/sha256.js";
import { instantiateSha512 } from "@bitauth/libauth/build/lib/crypto/sha512.js";

type HashFunction = {
    final: (rawState: Uint8Array) => Uint8Array;
    hash: (input: Uint8Array) => Uint8Array;
    init: () => Uint8Array;
    update: (rawState: Uint8Array, input: Uint8Array) => Uint8Array;
};

export let sha1: HashFunction;
export let sha256: HashFunction;
export let sha512: HashFunction;
export let ripemd160: HashFunction;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export let secp256k1: any;

let pending: Promise<void> | null = null;

export function ensureBchCrypto(): Promise<void> {
    if (!pending) {
        pending = Promise.all([
            instantiateSha1(),
            instantiateSha256(),
            instantiateSha512(),
            instantiateRipemd160(),
            instantiateSecp256k1(),
        ]).then((instances) => {
            [sha1, sha256, sha512, ripemd160, secp256k1] = instances;
        });
    }
    return pending;
}
