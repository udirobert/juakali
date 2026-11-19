import {
    cashAddressToLockingBytecode,
    CashAddressType,
    decodeCashAddress,
    encodeCashAddress,
    hash160,
} from "@bitauth/libauth";

import { cashaddrPrefix, networkOfPrefix, type BchNetwork } from "./network";

/**
 * cashaddr helpers for the settlement layer. Ventures receive on a plain
 * P2PKH cashaddr (token-aware variants decode to the same locking bytecode —
 * wallets may hand us either form).
 */
export function lockingBytecodeForAddress(address: string): Uint8Array {
    const result = cashAddressToLockingBytecode(address.trim());
    if (typeof result === "string") throw new Error(`Invalid BCH address: ${result}`);
    return result.bytecode;
}

export function isValidCashAddress(address: string, network?: BchNetwork): boolean {
    try {
        const decoded = decodeCashAddress(address.trim());
        if (typeof decoded === "string") return false;
        if (network && networkOfPrefix(decoded.prefix) !== network) return false;
        return decoded.type === CashAddressType.p2pkh || decoded.type === CashAddressType.p2pkhWithTokens;
    } catch {
        return false;
    }
}

export function pubkeyToP2pkhAddress(pubkey: Uint8Array, network: BchNetwork): string {
    const encoded = encodeCashAddress({
        prefix: cashaddrPrefix(network),
        type: CashAddressType.p2pkh,
        payload: hash160(pubkey),
    });
    if (typeof encoded === "string") throw new Error(`Could not encode address: ${encoded}`);
    return encoded.address;
}

/** Short display form: bchtest:qp…h6lc */
export function shortAddress(address: string): string {
    const [prefix, rest] = address.split(":");
    const body = rest ?? address;
    const trimmed = body.length > 10 ? `${body.slice(0, 4)}…${body.slice(-4)}` : body;
    return prefix ? `${prefix}:${trimmed}` : trimmed;
}

export function shortTxid(txid: string): string {
    return txid.length > 16 ? `${txid.slice(0, 8)}…${txid.slice(-6)}` : txid;
}
