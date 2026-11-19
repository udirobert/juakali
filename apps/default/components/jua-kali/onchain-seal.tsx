import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { color, font, radius } from "@/components/jua-kali/theme";
import { explorerTxUrl, type BchNetwork } from "@/lib/bch/network";
import { shortTxid } from "@/lib/bch/address";

const mono = Platform.select({ ios: "Menlo", default: "monospace" });

/**
 * The settlement seal — a txid rendered as a stamped capsule. Brass for
 * mainnet (real settlement), cool lab ink on chipnet so test coins never
 * cosplay as value. Tapping verifies on blockexplorer.cash — the chain is
 * the source of truth, this is only its fingerprint.
 */
export function OnchainSeal({
    txid,
    network,
    onchainRef,
    size = "md",
}: {
    txid: string;
    network: BchNetwork;
    /** Precomputed explorer URL stored on the ledger event, if present. */
    onchainRef?: string | null;
    size?: "sm" | "md";
}) {
    const test = network === "chipnet";
    return (
        <Pressable
            onPress={() => void Linking.openURL(onchainRef ?? explorerTxUrl(txid, network))}
            accessibilityRole="link"
            accessibilityLabel={`Verify transaction ${txid} on the block explorer`}
            hitSlop={4}
            style={({ pressed }) => [styles.seal, test && styles.sealTest, size === "sm" && styles.sealSm, pressed && styles.pressed]}
        >
            <View style={[styles.dot, test && styles.dotTest]} />
            <Text style={[styles.hash, test && styles.hashTest, size === "sm" && styles.hashSm]}>
                {shortTxid(txid)}
            </Text>
            <Text style={[styles.arrow, test && styles.arrowTest]}>↗</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    seal: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        alignSelf: "flex-start",
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: color.brassBorder,
        backgroundColor: color.brassSoft,
    },
    sealTest: {
        borderColor: color.lineStrong,
        backgroundColor: color.paper,
    },
    sealSm: { paddingHorizontal: 8, paddingVertical: 4, gap: 5 },
    pressed: { opacity: 0.7 },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.brass },
    dotTest: { backgroundColor: color.mist },
    hash: { fontFamily: mono, fontSize: 12, color: color.brassDeep, fontWeight: "600" },
    hashTest: { color: color.mist },
    hashSm: { fontSize: 11 },
    arrow: { fontFamily: font.bodyBold, fontSize: 11, color: color.brassDeep },
    arrowTest: { color: color.mist },
});
