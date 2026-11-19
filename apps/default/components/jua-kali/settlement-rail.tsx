import { StyleSheet, Text, View } from "react-native";

import { color, font, radius } from "@/components/jua-kali/theme";

/**
 * The capital path, made legible: pledge recorded → address bound → funded
 * on-chain → repaid. Pure presentation — every node derives from real
 * commitment fields, so a judge watching a demo sees the journey light up
 * as settlement actually lands. The rail never claims a stage the data
 * hasn't reached.
 */
export type SettlementStage = "pledged" | "bound" | "funded" | "repaying" | "repaid";

const STEPS: { id: SettlementStage; label: string; hint: string }[] = [
    { id: "pledged", label: "Pledged", hint: "soft intent" },
    { id: "bound", label: "Address", hint: "bound" },
    { id: "funded", label: "Funded", hint: "on-chain" },
    { id: "repaid", label: "Repaid", hint: "on-chain" },
];

const ORDER: SettlementStage[] = ["pledged", "bound", "funded", "repaying", "repaid"];

export function settlementStage(args: {
    hasAddress: boolean;
    pledgeTxid: string | null;
    repaidTotal: number | null;
    amountKes: number;
}): SettlementStage {
    if (!args.hasAddress) return "pledged";
    if (!args.pledgeTxid) return "bound";
    // Full repayment in sats vs a KES-denominated cap can't be compared
    // honestly — "repaying" is the truthful terminal state until the asset
    // unit is settled. repaid == repaidTotal present and the pledge cap met
    // in the same unit; for now any repayment past the pledge marks repaying.
    if (args.repaidTotal && args.repaidTotal > 0) return "repaying";
    return "funded";
}

export function SettlementRail({ stage }: { stage: SettlementStage }) {
    const reached = (id: SettlementStage) => ORDER.indexOf(id) <= ORDER.indexOf(stage);
    // "repaying" lights the final node as active-but-unfinished.
    const currentIndex = stage === "repaying" ? 3 : ORDER.indexOf(stage);

    return (
        <View style={styles.rail} accessibilityRole="summary">
            {STEPS.map((step, i) => {
                const done = i < currentIndex;
                const current = i === currentIndex;
                const complete = reached(step.id) && !current;
                return (
                    <View key={step.id} style={styles.item}>
                        <View style={styles.nodeRow}>
                            {i > 0 ? <View style={[styles.link, done || current ? styles.linkLit : null]} /> : null}
                            <View
                                style={[
                                    styles.node,
                                    (done || complete) && styles.nodeDone,
                                    current && styles.nodeCurrent,
                                ]}
                            >
                                {current ? <View style={styles.nodeInner} /> : null}
                            </View>
                            {i < STEPS.length - 1 ? (
                                <View style={[styles.link, done ? styles.linkLit : null]} />
                            ) : null}
                        </View>
                        <Text style={[styles.label, (done || current || complete) && styles.labelLit]}>
                            {step.label}
                        </Text>
                        <Text style={styles.hint}>{step.hint}</Text>
                    </View>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    rail: { flexDirection: "row", alignItems: "flex-start" },
    item: { flex: 1, alignItems: "center", gap: 3 },
    nodeRow: { flexDirection: "row", alignItems: "center", width: "100%" },
    link: { flex: 1, height: 1, backgroundColor: color.line },
    linkLit: { backgroundColor: color.brass },
    node: {
        width: 12,
        height: 12,
        borderRadius: radius.pill,
        borderWidth: 1.5,
        borderColor: color.lineStrong,
        backgroundColor: color.paper,
        alignItems: "center",
        justifyContent: "center",
    },
    nodeDone: { backgroundColor: color.brass, borderColor: color.brass },
    nodeCurrent: { borderColor: color.brass, borderWidth: 2 },
    nodeInner: { width: 4, height: 4, borderRadius: 2, backgroundColor: color.brass },
    label: {
        fontFamily: font.bodyBold,
        fontSize: 9,
        fontWeight: "700",
        letterSpacing: 0.5,
        textTransform: "uppercase",
        color: color.mistSoft,
    },
    labelLit: { color: color.brassDeep },
    hint: {
        fontFamily: font.body,
        fontSize: 9,
        color: color.mistSoft,
    },
});
