import { useEffect, useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useMutation, useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { BchQr } from "@/components/jua-kali/bch-qr";
import { useBchWallet } from "@/components/jua-kali/hooks/use-bch-wallet";
import { OnchainSeal } from "@/components/jua-kali/onchain-seal";
import { SettlementRail, settlementStage } from "@/components/jua-kali/settlement-rail";
import { Button, Card, Input } from "@/components/jua-kali/ui";
import { color, font, radius, type as typeStyle } from "@/components/jua-kali/theme";
import { explorerAddressUrl, explorerTxUrl, BCH_PLEDGE_TOKEN_CATEGORY, BCH_PLEDGE_TOKEN_AMOUNT } from "@/lib/bch/network";
import { shortAddress } from "@/lib/bch/address";
import { ensureBchCrypto } from "@/lib/bch/libauth-crypto-shim";
import { bindingPayload, publishBindingEvent, ventureNostrKey } from "@/lib/nostr/identity";

const mono = Platform.select({ ios: "Menlo", default: "monospace" });

/**
 * The settlement card on a deal — the "live" capital path next to the soft
 * pledge. The rail shows where this commitment sits; every state is honest:
 * chipnet is test coins, Convex only caches what the chain already proved.
 */
export function FundOnBchCard({ commitmentId }: { commitmentId: Id<"commitments"> }) {
    const deal = useQuery(api.invest.getDeal, { commitmentId });
    // WizardConnect restores a stored session in a mount-time effect whose
    // relay client needs libauth WASM — so the wallet hook can only mount once
    // crypto is ready, or the restore path crashes with a cold `secp256k1`.
    const [cryptoReady, setCryptoReady] = useState(false);
    useEffect(() => {
        if (Platform.OS !== "web") return;
        void ensureBchCrypto()
            .then(() => setCryptoReady(true))
            .catch(() => setCryptoReady(false));
    }, []);

    if (!deal) return null;
    // Native runtimes lack WebAssembly — libauth crypto (and therefore
    // WizardConnect) is web-only for the BLAZE slice.
    if (Platform.OS !== "web") return null;
    if (!cryptoReady) return null;
    return <FundOnBchCardReady commitmentId={commitmentId} />;
}

function FundOnBchCardReady({ commitmentId }: { commitmentId: Id<"commitments"> }) {
    const deal = useQuery(api.invest.getDeal, { commitmentId });
    const recordFunding = useMutation(api.invest.recordPledgeFunding);
    const setSettlement = useMutation(api.invest.setVentureSettlement);
    const recordRepayment = useMutation(api.invest.recordRepayment);
    const bindIdentity = useMutation(api.invest.bindVentureIdentity);
    const wallet = useBchWallet();

    const [amountText, setAmountText] = useState("");
    const [addressText, setAddressText] = useState("");
    const [showQr, setShowQr] = useState(false);
    const [showRepay, setShowRepay] = useState(false);
    const [repayTxid, setRepayTxid] = useState("");
    const [repayAmount, setRepayAmount] = useState("");
    const [repayBusy, setRepayBusy] = useState(false);
    const [busy, setBusy] = useState(false);
    const [bindBusy, setBindBusy] = useState(false);
    const [idBusy, setIdBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!deal) return null;
    // Native runtimes lack WebAssembly — libauth crypto (and therefore
    // WizardConnect) is web-only for the BLAZE slice.
    if (Platform.OS !== "web") return null;

    const ventureAddress = deal.bchAddress ?? null;
    const network = wallet.network;
    const test = network === "chipnet";
    const connected = wallet.state === "connected" && wallet.scan;
    const alreadyFunded = Boolean(deal.pledgeTxid);
    const stage = settlementStage({
        hasAddress: Boolean(ventureAddress),
        pledgeTxid: deal.pledgeTxid,
        repaidTotal: deal.repaidTotal,
        amountKes: deal.amountKes,
    });
    const fundedNetwork = deal.settlementNetwork === "mainnet" ? "mainnet" : "chipnet";

    // Attach the configured pledge token (e.g. PUSD) only when the wallet
    // holds enough of it — otherwise the spend stays a plain BCH pledge.
    const pledgeToken = (() => {
        if (!BCH_PLEDGE_TOKEN_CATEGORY || BCH_PLEDGE_TOKEN_AMOUNT <= 0n) return null;
        const cat = BCH_PLEDGE_TOKEN_CATEGORY.toLowerCase();
        const held = (wallet.scan?.utxos ?? []).reduce((sum, u) => {
            if (!u.token) return sum;
            const hex = Array.from(u.token.category)
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("");
            return hex === cat ? sum + u.token.amount : sum;
        }, 0n);
        return held >= BCH_PLEDGE_TOKEN_AMOUNT
            ? { category: BCH_PLEDGE_TOKEN_CATEGORY, amount: BCH_PLEDGE_TOKEN_AMOUNT }
            : null;
    })();

    async function handleFund() {
        if (!deal || !ventureAddress) return;
        const sats = BigInt(amountText.trim() || "0");
        if (sats <= 0n) {
            setError("Enter an amount in satoshis.");
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const txid = await wallet.fundPledge({
                toAddress: ventureAddress,
                satoshis: sats,
                userPrompt: `Fund ${deal.ventureName} pledge — ${sats} sats`,
                token: pledgeToken ?? undefined,
            });
            await recordFunding({
                commitmentId,
                txid,
                asset: pledgeToken ? "pusd" : "bch",
                network,
                settlementAddress: ventureAddress,
                amount: Number(sats),
                onchainRef: explorerTxUrl(txid, network),
            });
        } catch (e) {
            setError(e instanceof Error ? e.message : "Funding failed");
        } finally {
            setBusy(false);
        }
    }

    async function handleBind() {
        const addr = addressText.trim();
        if (!deal || !addr) return;
        setBindBusy(true);
        setError(null);
        try {
            await setSettlement({ ventureId: deal.ventureId, bchAddress: addr });
            setAddressText("");
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not bind address");
        } finally {
            setBindBusy(false);
        }
    }

    async function handleBindIdentity() {
        if (!deal || !ventureAddress) return;
        setIdBusy(true);
        setError(null);
        try {
            // Two-way proof: the wallet signs an OP_RETURN tx committing the
            // npub on-chain; the venture's own Nostr key signs an event naming
            // the address + txid. Third parties verify both independently.
            const key = ventureNostrKey(deal.ventureId);
            const txid = await wallet.bindIdentity({
                payload: bindingPayload(key.npub),
                userPrompt: `Bind ${deal.ventureName} identity — commit npub on-chain`,
            });
            const { eventId } = await publishBindingEvent({
                secretKey: key.secretKey,
                bchAddress: ventureAddress,
                bindingTxid: txid,
                network,
            });
            await bindIdentity({
                ventureId: deal.ventureId,
                nostrPubkey: key.pubkey,
                bindingTxid: txid,
                nostrEventId: eventId,
            });
        } catch (e) {
            setError(e instanceof Error ? e.message : "Identity binding failed");
        } finally {
            setIdBusy(false);
        }
    }

    async function handleRepay() {
        if (!deal) return;
        const txid = repayTxid.trim().toLowerCase();
        const amount = Number(repayAmount.trim() || "0");
        if (!/^[0-9a-f]{64}$/.test(txid)) {
            setError("Repayment txid must be a 64-hex transaction hash.");
            return;
        }
        if (!Number.isFinite(amount) || amount <= 0) {
            setError("Enter the repaid amount in satoshis.");
            return;
        }
        setRepayBusy(true);
        setError(null);
        try {
            await recordRepayment({
                commitmentId,
                txid,
                network,
                amount,
                onchainRef: explorerTxUrl(txid, network),
            });
            setRepayTxid("");
            setRepayAmount("");
            setShowRepay(false);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not record repayment");
        } finally {
            setRepayBusy(false);
        }
    }

    return (
        <Card variant="trust">
            <View style={styles.headRow}>
                <Text style={styles.eyebrow}>On-chain settlement</Text>
                <View style={[styles.netBadge, !test && styles.netBadgeLive]}>
                    <View style={[styles.netDot, !test && styles.netDotLive]} />
                    <Text style={[styles.netText, !test && styles.netTextLive]}>
                        {test ? "chipnet · test coins" : "mainnet · real BCH"}
                    </Text>
                </View>
            </View>

            <SettlementRail stage={stage} />

            {!ventureAddress ? (
                <View style={styles.gap}>
                    <Text style={styles.body}>
                        {deal.ventureName} has no BCH receiving address yet. Bind the venture's wallet
                        address to open the on-chain path.
                    </Text>
                    <Input
                        value={addressText}
                        onChangeText={setAddressText}
                        placeholder={test ? "bchtest:q…" : "bitcoincash:q…"}
                        autoCapitalize="none"
                        autoCorrect={false}
                    />
                    <Button
                        label={bindBusy ? "Binding…" : "Bind settlement address"}
                        onPress={() => void handleBind()}
                        disabled={bindBusy || !addressText.trim()}
                        busy={bindBusy}
                        variant="ghost"
                    />
                </View>
            ) : (
                <Pressable
                    onPress={() => void Linking.openURL(explorerAddressUrl(ventureAddress, network))}
                    hitSlop={6}
                    accessibilityRole="link"
                >
                    <Text style={styles.meta}>
                        Venture address <Text style={styles.metaMono}>{shortAddress(ventureAddress)}</Text> ↗
                    </Text>
                </Pressable>
            )}

            {alreadyFunded ? (
                <View style={styles.sealedBox}>
                    <Text style={styles.sealedTitle}>Pledge funded on-chain</Text>
                    <OnchainSeal
                        txid={deal.pledgeTxid!}
                        network={fundedNetwork}
                        onchainRef={explorerTxUrl(deal.pledgeTxid!, fundedNetwork)}
                    />
                    {deal.repaidTotal && deal.repaidTotal > 0 ? (
                        <Text style={styles.meta}>
                            Repaid: {deal.repaidTotal.toLocaleString()} sats across{" "}
                            {deal.repayTxids.length} transaction{deal.repayTxids.length === 1 ? "" : "s"}
                        </Text>
                    ) : (
                        <Text style={styles.meta}>
                            Awaiting repayment — the venture returns a share of revenue to this
                            address as the ledger grows.
                        </Text>
                    )}
                    {showRepay ? (
                        <View style={styles.repayForm}>
                            <Text style={styles.meta}>
                                Repaid on the explorer? Paste the transaction id to anchor it to
                                this pledge.
                            </Text>
                            <Input
                                value={repayTxid}
                                onChangeText={setRepayTxid}
                                placeholder="Transaction id (64-hex)"
                                autoCapitalize="none"
                                autoCorrect={false}
                            />
                            <Input
                                value={repayAmount}
                                onChangeText={setRepayAmount}
                                keyboardType="number-pad"
                                placeholder="Repaid amount in satoshis"
                            />
                            <Button
                                label={repayBusy ? "Recording…" : "Anchor repayment"}
                                onPress={() => void handleRepay()}
                                disabled={repayBusy}
                                busy={repayBusy}
                                variant="ghost"
                            />
                        </View>
                    ) : (
                        <Pressable onPress={() => setShowRepay(true)} hitSlop={6}>
                            <Text style={styles.link}>Record a repayment →</Text>
                        </Pressable>
                    )}
                    <Text style={styles.truthNote}>
                        Chain is the source of truth — this entry caches the txid.
                    </Text>
                </View>
            ) : ventureAddress ? (
                <View style={styles.gap}>
                    {wallet.state !== "connected" ? (
                        <>
                            <Button
                                label={
                                    wallet.state === "connecting" || wallet.state === "reconnecting"
                                        ? "Waiting for wallet…"
                                        : "Connect BCH wallet"
                                }
                                onPress={() => {
                                    if (wallet.connect()) setShowQr(true);
                                }}
                                disabled={wallet.state === "connecting" || wallet.state === "reconnecting"}
                                variant="approve"
                            />
                            {showQr && wallet.qrUri ? (
                                <View style={styles.qrPanel}>
                                    <View style={styles.qrFrame}>
                                        <BchQr value={wallet.qrUri} size={188} />
                                    </View>
                                    <Text style={styles.qrHint}>
                                        Scan with Selene, Paytaca or Cashonize
                                    </Text>
                                    <Text selectable style={styles.uri}>
                                        {wallet.uri}
                                    </Text>
                                </View>
                            ) : null}
                        </>
                    ) : (
                        <>
                            <View style={styles.walletRow}>
                                <View style={styles.walletDot} />
                                <Text style={styles.meta}>
                                    {wallet.walletName ?? "Wallet"} ·{" "}
                                    {wallet.scanning || !wallet.scan
                                        ? "scanning addresses…"
                                        : `${Number(wallet.scan.balanceSats).toLocaleString()} sats spendable`}
                                </Text>
                            </View>
                            <Input
                                value={amountText}
                                onChangeText={setAmountText}
                                keyboardType="number-pad"
                                placeholder="Amount in satoshis (100k ≈ $1)"
                            />
                            <Button
                                label={busy ? "Waiting for wallet signature…" : "Fund this pledge on BCH"}
                                onPress={() => void handleFund()}
                                disabled={busy || wallet.scanning || !connected}
                                busy={busy}
                                variant="approve"
                            />
                            {pledgeToken ? (
                                <Text style={styles.meta}>
                                    A PUSD CashToken rides with this pledge.
                                </Text>
                            ) : null}
                            <View style={styles.rowLinks}>
                                <Pressable onPress={() => void wallet.rescan()} hitSlop={6}>
                                    <Text style={styles.link}>Refresh balance</Text>
                                </Pressable>
                                <Pressable onPress={() => void wallet.disconnect()} hitSlop={6}>
                                    <Text style={styles.link}>Disconnect</Text>
                                </Pressable>
                            </View>
                            {deal.identityProof ? (
                                <View style={styles.identityBox}>
                                    <Text style={styles.identityTitle}>Identity bound · self-sovereign</Text>
                                    <Text selectable style={styles.metaMono}>
                                        npub: {deal.nostrPubkey?.slice(0, 20)}…
                                    </Text>
                                    <Text selectable style={styles.metaMono}>
                                        bch: {shortAddress(ventureAddress!)}
                                    </Text>
                                    <View style={styles.rowLinks}>
                                        <Pressable
                                            onPress={() =>
                                                void Linking.openURL(
                                                    explorerTxUrl(deal.identityProof!.bchSignature, fundedNetwork)
                                                )
                                            }
                                            hitSlop={6}
                                        >
                                            <Text style={styles.link}>OP_RETURN proof tx</Text>
                                        </Pressable>
                                        <Pressable
                                            onPress={() =>
                                                void Linking.openURL(
                                                    `https://njump.me/${deal.identityProof!.nostrEventId}`
                                                )
                                            }
                                            hitSlop={6}
                                        >
                                            <Text style={styles.link}>Nostr attestation</Text>
                                        </Pressable>
                                    </View>
                                    <Text style={styles.meta}>
                                        Two-way proof: the OP_RETURN tx commits the npub on-chain;
                                        the signed Nostr event names the address + txid. Verify both
                                        independently — no JuaKali trust required.
                                    </Text>
                                </View>
                            ) : (
                                <View style={styles.identityBox}>
                                    <Text style={styles.identityTitle}>Decentralized identity</Text>
                                    <Text style={styles.meta}>
                                        Bind this venture's BCH address to a Nostr key it controls.
                                        An OP_RETURN tx commits the npub on-chain; a signed Nostr
                                        event carries the reverse attestation.
                                    </Text>
                                    <Button
                                        label={idBusy ? "Signing + publishing…" : "Bind Nostr identity"}
                                        onPress={() => void handleBindIdentity()}
                                        disabled={idBusy || wallet.scanning || !connected}
                                        busy={idBusy}
                                        variant="ghost"
                                    />
                                </View>
                            )}
                        </>
                    )}
                </View>
            ) : null}

            {wallet.connectError ? <Text selectable style={styles.error}>{wallet.connectError}</Text> : null}
            {wallet.scanError ? <Text selectable style={styles.error}>{wallet.scanError}</Text> : null}
            {error ? <Text selectable style={styles.error}>{error}</Text> : null}
        </Card>
    );
}

const styles = StyleSheet.create({
    headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    eyebrow: typeStyle.eyebrow,
    netBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: color.lineStrong,
        backgroundColor: color.paper,
    },
    netBadgeLive: { borderColor: color.brassBorder, backgroundColor: color.brassSoft },
    netDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.mist },
    netDotLive: { backgroundColor: color.brass },
    netText: {
        fontFamily: font.bodyBold,
        fontSize: 9,
        fontWeight: "700",
        letterSpacing: 0.6,
        textTransform: "uppercase",
        color: color.mist,
    },
    netTextLive: { color: color.brassDeep },
    body: { ...typeStyle.body, fontSize: 14, lineHeight: 20 },
    meta: typeStyle.meta,
    metaMono: { fontFamily: mono, fontSize: 11 },
    link: { ...typeStyle.meta, color: color.brassDeep, fontWeight: "700" },
    sealedBox: {
        gap: 10,
        padding: 12,
        borderRadius: radius.sm,
        borderWidth: 1,
        borderColor: color.brassBorder,
        backgroundColor: color.brassSoft,
    },
    sealedTitle: {
        fontFamily: font.displayMedium,
        fontSize: 15,
        fontWeight: "600",
        color: color.charcoal,
    },
    truthNote: { ...typeStyle.meta, fontSize: 10, color: color.mistSoft },
    repayForm: {
        gap: 8,
        paddingTop: 10,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: color.brassBorder,
    },
    qrPanel: { alignItems: "center", gap: 8, paddingVertical: 6 },
    qrFrame: {
        padding: 14,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: color.lineStrong,
        backgroundColor: color.foam,
    },
    qrHint: { ...typeStyle.meta, fontSize: 11 },
    uri: {
        fontFamily: mono,
        fontSize: 10,
        color: color.mist,
        paddingHorizontal: 8,
    },
    walletRow: { flexDirection: "row", alignItems: "center", gap: 7 },
    walletDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: color.success },
    rowLinks: { flexDirection: "row", gap: 18, justifyContent: "center" },
    identityBox: {
        gap: 8,
        padding: 12,
        borderRadius: radius.sm,
        borderWidth: 1,
        borderColor: color.lineStrong,
        backgroundColor: color.paper,
    },
    identityTitle: { ...typeStyle.meta, fontWeight: "700", color: color.ink },
    error: { ...typeStyle.meta, color: color.danger },
    gap: { gap: 10 },
});
