import { getNetworkProvider, Network } from "mainnet-js";

/**
 * BCH settlement layer (BCH Blaze 2026). The chain is the source of truth for
 * value transfer — these helpers only fetch UTXOs and broadcast raw signed tx
 * hex that the connected wallet produced.
 *
 * Network picks one electrum cluster:
 *  - "chipnet"  → bchtest: addresses, free faucet coins, for development/demo
 *  - "mainnet"  → bitcoincash: addresses, real settlement
 *
 * mainnet-js 3.1.7 maps Network.TESTNET onto its chipnet server list.
 */
export type BchNetwork = "chipnet" | "mainnet";

export const BCH_NETWORK: BchNetwork =
    (process.env.EXPO_PUBLIC_BCH_NETWORK ?? "chipnet").toLowerCase() === "mainnet"
        ? "mainnet"
        : "chipnet";

const MAINNET_PREFIX = "bitcoincash";
const CHIPNET_PREFIX = "bchtest";

export function cashaddrPrefix(network: BchNetwork = BCH_NETWORK) {
    return network === "mainnet" ? MAINNET_PREFIX : CHIPNET_PREFIX;
}

export function networkOfPrefix(prefix: string): BchNetwork | null {
    if (prefix === MAINNET_PREFIX) return "mainnet";
    if (prefix === CHIPNET_PREFIX) return "chipnet";
    return null;
}

export function electrum() {
    return getNetworkProvider(BCH_NETWORK === "mainnet" ? Network.MAINNET : Network.TESTNET);
}

/**
 * Optional CashToken attached to pledge spends (e.g. PUSD on mainnet).
 * Category is the 32-byte token-id hex; amount is raw fungible units.
 * Disabled unless both are set — plain BCH pledges remain the default.
 */
export const BCH_PLEDGE_TOKEN_CATEGORY: string | null =
    (process.env.EXPO_PUBLIC_BCH_PLEDGE_TOKEN ?? "").trim() || null;

export const BCH_PLEDGE_TOKEN_AMOUNT: bigint = (() => {
    try {
        return BigInt(process.env.EXPO_PUBLIC_BCH_PLEDGE_TOKEN_AMOUNT ?? "0");
    } catch {
        return 0n;
    }
})();

export function explorerTxUrl(txid: string, network: BchNetwork = BCH_NETWORK): string {
    return network === "mainnet"
        ? `https://blockexplorer.cash/tx/${txid}`
        : `https://blockexplorer.cash/chipnet/tx/${txid}`;
}

export function explorerAddressUrl(address: string, network: BchNetwork = BCH_NETWORK): string {
    return network === "mainnet"
        ? `https://blockexplorer.cash/address/${address}`
        : `https://blockexplorer.cash/chipnet/address/${address}`;
}
