import type { Transaction } from "@bitauth/libauth";
import { encodeDataPush, hexToBin } from "@bitauth/libauth";

/**
 * Unsigned pledge spend — built by the dapp, signed by the wallet.
 *
 * The wallet owns keys; the dapp owns UTXO selection and outputs. What we hand
 * to WizardConnect is a libauth-shaped unsigned transaction plus a
 * `sourceOutputs` entry per input (the UTXO being spent, incl. its locking
 * bytecode and value — the wallet needs these to compute sighash).
 *
 * BCH only by default. Passing `token` adds a CashToken (e.g. PUSD) amount to
 * the recipient output: token-category UTXOs are selected first, excess token
 * balance returns on the change output, and foreign token UTXOs are never
 * touched (spending one without carrying its token would burn it).
 */
export type FundedUtxo = {
    txid: string;
    vout: number;
    satoshis: bigint;
    lockingBytecode: Uint8Array;
    /** Which wallet path/index this UTXO sits on — fills inputPaths. */
    pathName: string;
    addressIndex: number;
    /** Fungible CashToken balance on this UTXO, when token-bearing. */
    token?: { category: Uint8Array; amount: bigint };
};

/** A CashToken (e.g. PUSD) amount to ride alongside the BCH pledge spend. */
export type TokenSpend = {
    /** Token category id — 32-byte hex (display order). */
    category: string;
    amount: bigint;
};

export type BuiltSpend = {
    transaction: Transaction;
    sourceOutputs: {
        outpointTransactionHash: Uint8Array;
        outpointIndex: number;
        sequenceNumber: number;
        unlockingBytecode: Uint8Array;
        lockingBytecode: Uint8Array;
        valueSatoshis: bigint;
        token?: { category: Uint8Array; amount: bigint };
    }[];
    /** [inputIndex, pathName, addressIndex] per input — WizardConnect hdwalletv1. */
    inputPaths: [number, string, number][];
    changeSatoshis: bigint;
    feeSatoshis: bigint;
};

const DUST_LIMIT = 546n;
/** Rough per-input/upper-bound bytes: P2PKH input ~148B, output ~34B, tx base ~10B. */
const TX_BASE_BYTES = 10n;
const INPUT_BYTES = 150n;
const OUTPUT_BYTES = 34n;
/** Extra bytes a token output/input carries (category + amount/commitment prefix). */
const TOKEN_OUTPUT_BYTES = 45n;
const SATS_PER_BYTE = 1n;

export function estimateFee(inputCount: number, outputCount: number, tokenOutputs = 0): bigint {
    const bytes =
        TX_BASE_BYTES +
        INPUT_BYTES * BigInt(inputCount) +
        OUTPUT_BYTES * BigInt(outputCount) +
        TOKEN_OUTPUT_BYTES * BigInt(tokenOutputs);
    return bytes * SATS_PER_BYTE;
}

/**
 * Greedy selection: take largest-first until the target + fee is covered.
 * `outputCount` must include the prospective change output to size the fee
 * correctly; change below dust is folded into the fee instead.
 */
export function buildPledgeSpend(args: {
    utxos: FundedUtxo[];
    toBytecode: Uint8Array;
    satoshis: bigint;
    changeBytecode: Uint8Array;
    /** Optional CashToken amount on the recipient output (e.g. PUSD units). */
    token?: TokenSpend;
}): BuiltSpend {
    const { utxos, toBytecode, satoshis, changeBytecode, token } = args;
    if (satoshis < DUST_LIMIT) throw new Error(`Send amount below dust limit (${DUST_LIMIT} sats)`);
    if (token && token.amount <= 0n) throw new Error("Token amount must be positive");

    const categoryBin = token ? hexToBin(token.category) : null;
    if (categoryBin && categoryBin.length !== 32) {
        throw new Error("Token category must be a 32-byte hex id");
    }

    const bySats = (a: FundedUtxo, b: FundedUtxo) =>
        b.satoshis > a.satoshis ? 1 : b.satoshis < a.satoshis ? -1 : 0;
    const isCategory = (u: FundedUtxo) =>
        categoryBin !== null &&
        u.token !== undefined &&
        u.token.category.length === 32 &&
        u.token.category.every((b, i) => b === categoryBin[i]);

    // Token inputs first (they carry sats that count toward fee+amount too),
    // then plain BCH UTXOs until the sat target clears.
    const selected: FundedUtxo[] = [];
    let inputTotal = 0n;
    let tokenIn = 0n;
    if (categoryBin) {
        for (const utxo of utxos.filter((u) => isCategory(u) && u.satoshis > 0n).sort(bySats)) {
            if (tokenIn >= token!.amount) break;
            selected.push(utxo);
            inputTotal += utxo.satoshis;
            tokenIn += utxo.token!.amount;
        }
        if (tokenIn < token!.amount) {
            throw new Error(
                `Insufficient token balance: need ${token!.amount}, found ${tokenIn} for category ${token!.category}`
            );
        }
    }

    const tokenOutputCount = () => {
        const excess = tokenIn - (token?.amount ?? 0n);
        return (token ? 1 : 0) + (token && excess > 0n ? 1 : 0);
    };

    // Token-bearing UTXOs of other categories are never spendable — spending
    // one without carrying its token in an output would burn the token.
    for (const utxo of utxos
        .filter((u) => u.satoshis > 0n && !selected.includes(u) && !(u.token && !isCategory(u)))
        .sort(bySats)) {
        const fee = estimateFee(selected.length, 2, tokenOutputCount()) + 20n * BigInt(selected.filter(isCategory).length);
        if (inputTotal >= satoshis + fee) break;
        selected.push(utxo);
        inputTotal += utxo.satoshis;
    }

    const tokenInputs = selected.filter(isCategory).length;
    const fee =
        estimateFee(selected.length, 2, tokenOutputCount()) + 20n * BigInt(tokenInputs);
    if (inputTotal < satoshis + fee) {
        throw new Error(
            `Insufficient balance: need ${satoshis + fee} sats, found ${inputTotal} across ${selected.length} UTXOs`
        );
    }

    let change = inputTotal - satoshis - fee;
    const outputs: Transaction["outputs"] = [
        {
            lockingBytecode: toBytecode,
            valueSatoshis: satoshis,
            ...(token ? { token: { category: categoryBin!, amount: token.amount } } : {}),
        },
    ];
    const excessToken = token ? tokenIn - token.amount : 0n;
    if (change >= DUST_LIMIT) {
        outputs.push({
            lockingBytecode: changeBytecode,
            valueSatoshis: change,
            ...(excessToken > 0n
                ? { token: { category: categoryBin!, amount: excessToken } }
                : {}),
        });
    } else {
        change = 0n;
        // Token change has nowhere to go below dust — attach it to the only
        // output we control rather than burning it into the fee.
        if (excessToken > 0n) {
            throw new Error("Change below dust but excess tokens remain — top up or spend exact");
        }
    }

    const inputs = selected.map((u) => ({
        outpointTransactionHash: hexToBin(u.txid),
        outpointIndex: u.vout,
        sequenceNumber: 0xfffffffe,
        unlockingBytecode: new Uint8Array(0),
    }));

    return {
        transaction: { version: 2, inputs, outputs, locktime: 0 },
        sourceOutputs: selected.map((u, i) => ({
            ...inputs[i]!,
            lockingBytecode: u.lockingBytecode,
            valueSatoshis: u.satoshis,
            // Token-bearing inputs must carry their token data — the wallet
            // needs the full source output to compute the sighash preimage.
            ...(u.token ? { token: { category: u.token.category, amount: u.token.amount } } : {}),
        })),
        inputPaths: selected.map((u, i) => [i, u.pathName, u.addressIndex]),
        changeSatoshis: change,
        feeSatoshis: fee,
    };
}

/**
 * Identity-binding spend (Decentralized Identity bounty): an OP_RETURN output
 * commits the venture's Nostr pubkey on-chain from the wallet itself — proof
 * of BCH-key control that any third party can read on an explorer. The signed
 * Nostr event carries the reverse attestation (address + this txid).
 *
 * Plain BCH only — token UTXOs are skipped entirely so a binding spend can
 * never burn a token.
 */
export function buildIdentitySpend(args: {
    utxos: FundedUtxo[];
    /** Raw OP_RETURN payload bytes (e.g. utf8 "juakali:identity:npub1…"). */
    payload: Uint8Array;
    changeBytecode: Uint8Array;
}): BuiltSpend {
    const { utxos, payload, changeBytecode } = args;
    const opReturnBytecode = new Uint8Array([
        0x6a, // OP_RETURN
        ...encodeDataPush(payload),
    ]);

    const selected: FundedUtxo[] = [];
    let inputTotal = 0n;
    for (const utxo of utxos
        .filter((u) => u.satoshis > 0n && !u.token)
        .sort((a, b) => (b.satoshis > a.satoshis ? 1 : -1))) {
        const fee = estimateFee(selected.length + 1, 2);
        if (inputTotal >= fee) break;
        selected.push(utxo);
        inputTotal += utxo.satoshis;
    }
    const fee = estimateFee(selected.length, 2);
    if (inputTotal < fee) {
        throw new Error(`Insufficient balance for identity binding fee (${fee} sats)`);
    }
    const change = inputTotal - fee;
    if (change < DUST_LIMIT) {
        throw new Error(`Change below dust (${change} sats) — need a slightly larger UTXO`);
    }

    const outputs: Transaction["outputs"] = [
        { lockingBytecode: opReturnBytecode, valueSatoshis: 0n },
        { lockingBytecode: changeBytecode, valueSatoshis: change },
    ];
    const inputs = selected.map((u) => ({
        outpointTransactionHash: hexToBin(u.txid),
        outpointIndex: u.vout,
        sequenceNumber: 0xfffffffe,
        unlockingBytecode: new Uint8Array(0),
    }));

    return {
        transaction: { version: 2, inputs, outputs, locktime: 0 },
        sourceOutputs: selected.map((u, i) => ({
            ...inputs[i]!,
            lockingBytecode: u.lockingBytecode,
            valueSatoshis: u.satoshis,
        })),
        inputPaths: selected.map((u, i) => [i, u.pathName, u.addressIndex]),
        changeSatoshis: change,
        feeSatoshis: fee,
    };
}
