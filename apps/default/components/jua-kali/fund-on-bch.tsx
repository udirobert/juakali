import { useState } from "react";
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
import { explorerAddressUrl, explorerTxUrl } from "@/lib/bch/network";
import { shortAddress } from "@/lib/bch/address";

const mono = Platform.select({ ios: "Menlo", default: "monospace" });

/**
 * The settlement card on a deal — the "live" capital path next to the soft
 * pledge. The rail shows where this commitment sits; every state is honest:
 * chipnet is test coins, Convex only caches what the chain already proved.
 */
export function FundOnBchCard({ commitmentId }: { commitmentId: Id<"commitments"> }) {
    const deal = useQuery(api.invest.getDeal, { commitmentId });
    const recordFunding = useMutation(api.invest.recordPledgeFunding);
    const setSettlement = useMutation(api.invest.setVentureSettlement);
    const recordRepayment = useMutation(api.invest.recordRepayment);
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
            });
            await recordFunding({
                commitmentId,
                txid,
                asset: "bch",
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
                                    {wallet.scanning
                                        ? "scanning addresses…"
                                        : `${Number(wallet.scan!.balanceSats).toLocaleString()} sats spendable`}
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
                            <View style={styles.rowLinks}>
                                <Pressable onPress={() => void wallet.rescan()} hitSlop={6}>
                                    <Text style={styles.link}>Refresh balance</Text>
                                </Pressable>
                                <Pressable onPress={() => void wallet.disconnect()} hitSlop={6}>
                                    <Text style={styles.link}>Disconnect</Text>
                                </Pressable>
                            </View>
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
    error: { ...typeStyle.meta, color: color.danger },
    gap: { gap: 10 },
});
