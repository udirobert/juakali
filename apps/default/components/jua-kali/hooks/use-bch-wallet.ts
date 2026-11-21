import { useCallback, useEffect, useRef, useState } from "react";
import { useWizardConnect } from "@wizardconnect/react";
import { binToHex, encodeTransaction, hexToBin } from "@bitauth/libauth";

import { lockingBytecodeForAddress, pubkeyToP2pkhAddress } from "@/lib/bch/address";
import { BCH_NETWORK, electrum } from "@/lib/bch/network";
import { buildIdentitySpend, buildPledgeSpend, type BuiltSpend, type FundedUtxo, type TokenSpend } from "@/lib/bch/tx";
import { ensureBchCrypto } from "@/lib/bch/libauth-crypto-shim";

/**
 * WizardConnect session → spendable wallet view.
 *
 * hdwalletv1 gives the dapp named xpubs ("receive" → child 0, "change" →
 * child 1); we derive cashaddrs locally and scan electrum for funds. The
 * wallet never leaves the session — it only receives an unsigned tx plus the
 * source outputs it needs for sighash, and returns signed hex we broadcast.
 */

const RECEIVE_CHILD = 0;
const CHANGE_CHILD = 1;
const GAP_LIMIT = 20;

export type WalletScan = {
    utxos: FundedUtxo[];
    /** First unused index on each path (receive index kept for display). */
    receiveIndex: number;
    changeIndex: number;
    receiveAddress: string | null;
    changeAddress: string | null;
    balanceSats: bigint;
};

export function useBchWallet() {
    const wc = useWizardConnect({
        dappName: "JuaKali",
        dappIcon: undefined,
        sessionKey: "juakali-wc-session",
    });
    const [scan, setScan] = useState<WalletScan | null>(null);
    const [scanning, setScanning] = useState(false);
    const [scanError, setScanError] = useState<string | null>(null);
    const [cryptoError, setCryptoError] = useState<string | null>(null);
    const scanSeq = useRef(0);

    /** WASM crypto must be ready before the relay generates its session key. */
    const connect = useCallback((): boolean => {
        if (typeof WebAssembly === "undefined") {
            setCryptoError("On-chain funding needs a browser runtime (no WebAssembly on native yet).");
            return false;
        }
        ensureBchCrypto()
            .then(() => wc.connect())
            .catch((e) =>
                setCryptoError(e instanceof Error ? e.message : "Crypto init failed")
            );
        return true;
    }, [wc]);

    const rescan = useCallback(async () => {
        const manager = wc.manager;
        if (!manager || !manager.hasPath(RECEIVE_CHILD)) return;
        const seq = ++scanSeq.current;
        setScanning(true);
        setScanError(null);
        try {
            // Session restore skips connect() — crypto may still be cold here.
            await ensureBchCrypto();
            const provider = await electrum();
            const utxos: FundedUtxo[] = [];
            let receiveIndex = 0;
            let receiveAddress: string | null = null;
            let sawHistory = true;

            for (let i = 0; i < GAP_LIMIT && sawHistory; i++) {
                const pubkey = manager.getPubkey(RECEIVE_CHILD, BigInt(i));
                if (!pubkey) break;
                const address = pubkeyToP2pkhAddress(pubkey, BCH_NETWORK);
                if (i === 0) receiveAddress = address;
                const history = (await provider.getHistory(address).catch(() => [])) as unknown[];
                const found = await provider.getUtxos(address).catch(() => []);
                sawHistory = history.length > 0 || found.length > 0;
                if (!sawHistory) {
                    receiveIndex = i;
                    break;
                }
                for (const u of found) {
                    utxos.push({
                        txid: u.txid,
                        vout: u.vout,
                        satoshis: u.satoshis,
                        lockingBytecode: lockingBytecodeForAddress(address),
                        pathName: "receive",
                        addressIndex: i,
                        // Token UTXOs stay in the scan so the builder can match
                        // the spend category — and so it can refuse to burn
                        // foreign tokens in a plain BCH send.
                        token: u.token
                            ? {
                                  category: hexToBin(String(u.token.category)),
                                  amount: BigInt(u.token.amount),
                              }
                            : undefined,
                    });
                }
                receiveIndex = i + 1;
            }

            let changeIndex = 0;
            let changeAddress: string | null = null;
            if (manager.hasPath(CHANGE_CHILD)) {
                for (let i = 0; i < GAP_LIMIT; i++) {
                    const pubkey = manager.getPubkey(CHANGE_CHILD, BigInt(i));
                    if (!pubkey) break;
                    const address = pubkeyToP2pkhAddress(pubkey, BCH_NETWORK);
                    const history = (await provider.getHistory(address).catch(() => [])) as unknown[];
                    if (history.length === 0) {
                        changeIndex = i;
                        changeAddress = address;
                        break;
                    }
                }
            }

            if (seq !== scanSeq.current) return;
            setScan({
                utxos,
                receiveIndex,
                changeIndex,
                receiveAddress,
                changeAddress,
                // Dust locked on token UTXOs isn't freely spendable — excluded.
                balanceSats: utxos.reduce((sum, u) => (u.token ? sum : sum + u.satoshis), 0n),
            });
        } catch (e) {
            if (seq === scanSeq.current) setScanError(e instanceof Error ? e.message : "Scan failed");
        } finally {
            if (seq === scanSeq.current) setScanning(false);
        }
    }, [wc.manager]);

    useEffect(() => {
        if (wc.state === "connected") void rescan();
        else {
            setScan(null);
            setScanError(null);
        }
    }, [wc.state, rescan]);

    /**
     * Sign a built spend through the wallet and broadcast the result. The
     * relay JSON can't carry BigInt/Uint8Array — hdwalletv1's canonical wire
     * format is tx hex + source outputs with hex binary and `<bigint: Nn>`
     * values (same as @wizardconnect/core's private hdwalletv1-serialize.js).
     */
    const signAndBroadcast = useCallback(
        async (built: BuiltSpend, userPrompt: string) => {
            const manager = wc.manager;
            if (!manager || !scan) throw new Error("Wallet not connected");
            await ensureBchCrypto();

            const bigintTag = (v: bigint) => `<bigint: ${v}n>`;
            // Typed as libauth inputs/outputs upstream, but the wire format is
            // the tagged-JSON encoding below — the cast bridges the two.
            type RelaySourceOutput = {
                outpointTransactionHash: string;
                outpointIndex: number;
                unlockingBytecode: string;
                sequenceNumber: number;
                valueSatoshis: string;
                lockingBytecode: string;
                token?: { category: string; amount: string };
            };
            const response = await manager.signTransaction({
                transaction: {
                    transaction: binToHex(encodeTransaction(built.transaction)),
                    sourceOutputs: built.sourceOutputs.map((so): RelaySourceOutput => ({
                        outpointTransactionHash: binToHex(so.outpointTransactionHash),
                        outpointIndex: so.outpointIndex,
                        unlockingBytecode: binToHex(so.unlockingBytecode),
                        sequenceNumber: so.sequenceNumber,
                        valueSatoshis: bigintTag(so.valueSatoshis),
                        lockingBytecode: binToHex(so.lockingBytecode),
                        ...(so.token
                            ? {
                                  token: {
                                      category: binToHex(so.token.category),
                                      amount: bigintTag(so.token.amount),
                                  },
                              }
                            : {}),
                    })) as unknown as Parameters<typeof manager.signTransaction>[0]["transaction"]["sourceOutputs"],
                    userPrompt,
                },
                inputPaths: built.inputPaths as [number, string, number][],
            });
            if (response.error) throw new Error(response.error);
            if (!response.signedTransaction) throw new Error("Wallet returned no signed transaction");

            return await (await electrum()).sendRawTransaction(response.signedTransaction);
        },
        [wc.manager, scan]
    );

    const fundPledge = useCallback(
        async (args: {
            toAddress: string;
            satoshis: bigint;
            userPrompt: string;
            /** CashToken (e.g. PUSD) to attach to the venture output. */
            token?: TokenSpend;
        }) => {
            if (!scan?.changeAddress) throw new Error("No change path available in this session");
            const built = buildPledgeSpend({
                utxos: scan.utxos,
                toBytecode: lockingBytecodeForAddress(args.toAddress),
                satoshis: args.satoshis,
                changeBytecode: lockingBytecodeForAddress(scan.changeAddress),
                token: args.token,
            });
            return signAndBroadcast(built, args.userPrompt);
        },
        [scan, signAndBroadcast]
    );

    const bindIdentity = useCallback(
        async (args: { payload: Uint8Array; userPrompt: string }) => {
            if (!scan?.changeAddress) throw new Error("No change path available in this session");
            const built = buildIdentitySpend({
                utxos: scan.utxos,
                payload: args.payload,
                changeBytecode: lockingBytecodeForAddress(scan.changeAddress),
            });
            return signAndBroadcast(built, args.userPrompt);
        },
        [scan, signAndBroadcast]
    );

    return {
        state: wc.state,
        uri: wc.uri,
        qrUri: wc.qrUri,
        walletName: wc.walletName,
        connect,
        disconnect: wc.disconnect,
        connectError: wc.error ?? cryptoError,
        scan,
        scanning,
        scanError,
        rescan,
        fundPledge,
        bindIdentity,
        network: BCH_NETWORK,
    };
}
