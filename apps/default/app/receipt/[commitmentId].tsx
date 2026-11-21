import { useLocalSearchParams } from "expo-router";
import Head from "expo-router/head";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { LivingSun } from "@/components/jua-kali/living-sun";
import { DetailSkeleton } from "@/components/jua-kali/loaders/detail-skeleton";
import { color, font, type as typeStyle } from "@/components/jua-kali/theme";
import { explorerTxUrl } from "@/lib/bch/network";
import { shortAddress, shortTxid } from "@/lib/bch/address";

const mono = Platform.select({ ios: "Menlo", default: "monospace" });

/**
 * The settled receipt — the shareable artifact. One frame a judge can verify
 * without trusting us: the sealed pledge, the human it belongs to, the txid,
 * and the identity binding. Built to be screenshotted; every hash links out
 * to the chain or a relay. Chipnet receipts are labeled test coins — the
 * composition never lets test value cosplay as real settlement.
 */
export default function SettlementReceipt() {
    const { commitmentId } = useLocalSearchParams<{ commitmentId: string }>();
    const deal = useQuery(
        api.invest.getDeal,
        commitmentId ? { commitmentId: commitmentId as Id<"commitments"> } : "skip"
    );
    const insets = useSafeAreaInsets();

    if (deal === undefined) {
        return (
            <View style={[styles.page, { paddingTop: insets.top + 48 }]}>
                <DetailSkeleton />
            </View>
        );
    }
    if (!deal?.pledgeTxid) {
        return (
            <View style={[styles.page, { paddingTop: insets.top + 48 }]}>
                <Text style={styles.meta}>No settled pledge on this commitment yet.</Text>
            </View>
        );
    }

    const network = deal.settlementNetwork === "mainnet" ? "mainnet" : "chipnet";
    const test = network === "chipnet";
    const asset = deal.settlementAsset === "pusd" ? "pusd" : "bch";
    const amount =
        deal.fundedAmount != null
            ? `${deal.fundedAmount.toLocaleString()} ${asset === "pusd" ? "PUSD units" : "sats"}`
            : null;

    return (
        <View style={[styles.page, { paddingTop: insets.top + 32 }]}>
            <Head>
                <title>{`Receipt — ${deal.ventureName} · JuaKali`}</title>
            </Head>
            <View style={[styles.card, test && styles.cardTest]}>
                {/* The sealed sun — full noon = verified. */}
                <View style={[styles.sealRing, test && styles.sealRingTest]}>
                    <LivingSun size={104} agentState="verified" />
                </View>

                <Text style={[styles.eyebrow, test && styles.eyebrowTest]}>
                    {test ? "SETTLED ON-CHAIN · CHIPNET TEST COINS" : "SETTLED ON BITCOIN CASH"}
                </Text>
                <Text style={styles.venture}>{deal.ventureName}</Text>
                <Text style={styles.meta}>
                    {[deal.craftText, deal.locationText].filter(Boolean).join(" · ")}
                </Text>

                {amount ? <Text style={styles.amount}>{amount}</Text> : null}
                <Text style={styles.meta}>
                    soft revenue-share pledge → {test ? "settled on chipnet" : "settled on BCH mainnet"}
                </Text>

                <View style={styles.rule} />

                <Pressable
                    style={styles.row}
                    onPress={() => void Linking.openURL(explorerTxUrl(deal.pledgeTxid!, network))}
                    accessibilityRole="link"
                >
                    <Text style={styles.label}>funding tx</Text>
                    <Text selectable style={styles.hash}>
                        {shortTxid(deal.pledgeTxid!)} ↗
                    </Text>
                </Pressable>
                <View style={styles.row}>
                    <Text style={styles.label}>to</Text>
                    <Text selectable style={styles.hash}>
                        {shortAddress(deal.settlementAddress ?? "")}
                    </Text>
                </View>
                {deal.nostrPubkey && deal.identityProof ? (
                    <Pressable
                        style={styles.row}
                        onPress={() =>
                            void Linking.openURL(`https://njump.me/${deal.identityProof!.nostrEventId}`)
                        }
                        accessibilityRole="link"
                    >
                        <Text style={styles.label}>identity</Text>
                        <Text selectable style={styles.hash}>
                            npub {deal.nostrPubkey.slice(0, 12)}… ↗
                        </Text>
                    </Pressable>
                ) : null}

                <View style={styles.rule} />
                <Text style={styles.brand}>JUAKALI · INVEST IN PUBLIC</Text>
                <Text style={styles.meta}>
                    Every hash verifies independently — chain and relays are the source of truth.
                </Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    page: {
        flex: 1,
        backgroundColor: color.paper,
        alignItems: "center",
        paddingHorizontal: 24,
    },
    card: {
        width: "100%",
        maxWidth: 560,
        alignItems: "center",
        gap: 10,
        paddingVertical: 40,
        paddingHorizontal: 32,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: color.brassBorder,
        backgroundColor: color.paper,
        // Poster frame — double brass hairline.
        outlineWidth: 0,
        shadowColor: color.brass,
        shadowOpacity: 0.12,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 8 },
    },
    cardTest: { borderStyle: "dashed" },
    sealRing: {
        width: 128,
        height: 128,
        borderRadius: 64,
        borderWidth: 2,
        borderColor: color.brass,
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 8,
    },
    sealRingTest: { borderStyle: "dashed", borderColor: color.mist },
    eyebrow: { ...typeStyle.eyebrow, fontSize: 12 },
    eyebrowTest: { color: color.mist },
    venture: {
        fontFamily: font.display,
        fontSize: 38,
        fontWeight: "700",
        letterSpacing: -1,
        color: color.ink,
        textAlign: "center",
        lineHeight: 42,
    },
    amount: {
        fontFamily: font.displayMedium,
        fontSize: 30,
        fontWeight: "600",
        color: color.brassDeep,
        marginTop: 6,
    },
    rule: {
        width: "100%",
        height: 1,
        backgroundColor: color.brassBorder,
        marginVertical: 12,
    },
    row: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        width: "100%",
        paddingVertical: 3,
    },
    label: { ...typeStyle.eyebrow, fontSize: 10, letterSpacing: 1.2 },
    hash: { fontFamily: mono, fontSize: 13, color: color.ink },
    brand: { ...typeStyle.eyebrow, fontSize: 11, color: color.ink, marginTop: 4 },
    meta: { ...typeStyle.meta, textAlign: "center" },
});
