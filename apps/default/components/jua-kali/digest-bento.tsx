import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { SunMark } from "@/components/jua-kali/sun-mark";
import { Card } from "@/components/jua-kali/ui";
import { color, font, radius, space } from "@/components/jua-kali/theme";
import { relativeTime } from "@/components/jua-kali/cockpit/format";

export type DigestCardData = {
    id: string;
    commitmentId: string;
    ventureName: string;
    summary: string;
    insights: string;
    nextAction: string | null;
    evidence: string[];
    createdAt: number;
};

/**
 * Bento digest — the agent's produced document as a first-class artifact.
 * `featured` gets the full insight/next grid; compact tiles show summary only
 * so a filled desk reads as a composition, not a list of identical cards.
 */
export function DigestCard({
    digest,
    featured = false,
    onOpenLedger,
    onOpenDeal,
}: {
    digest: DigestCardData;
    featured?: boolean;
    onOpenLedger?: () => void;
    onOpenDeal?: () => void;
}) {
    const evidence = digest.evidence.length > 0 ? digest.evidence : ["agent"];

    return (
        <Card variant="artifact" style={[styles.card, featured && styles.cardFeatured]}>
            <View style={styles.top}>
                <View style={styles.titleRow}>
                    <SunMark size={featured ? 16 : 14} />
                    <Text style={[styles.title, !featured && styles.titleCompact]} numberOfLines={1}>
                        {digest.ventureName}
                    </Text>
                </View>
                <Text style={styles.when}>{relativeTime(digest.createdAt)}</Text>
            </View>

            <Text style={[styles.summary, featured && styles.summaryFeatured]} numberOfLines={featured ? 5 : 3}>
                {digest.summary}
            </Text>

            {featured ? (
                <>
                    <View style={styles.rule} />
                    <View style={styles.bentoGrid}>
                        <View style={styles.bentoCell}>
                            <Text style={styles.cellLabel}>Insight</Text>
                            <Text style={styles.cellBody}>{digest.insights}</Text>
                        </View>
                        {digest.nextAction ? (
                            <View style={[styles.bentoCell, styles.bentoCellNext]}>
                                <Text style={styles.cellLabel}>Next</Text>
                                <Text style={styles.cellBody}>{digest.nextAction}</Text>
                            </View>
                        ) : null}
                    </View>
                </>
            ) : null}

            <View style={styles.foot}>
                <View style={styles.evidenceRow}>
                    {evidence.slice(0, featured ? 4 : 2).map((tag) => (
                        <View key={tag} style={styles.chip}>
                            <Text style={styles.chipText}>{tag}</Text>
                        </View>
                    ))}
                </View>
                {onOpenLedger || onOpenDeal ? (
                    <Pressable onPress={onOpenDeal ?? onOpenLedger} hitSlop={8}>
                        <Text style={styles.link}>{onOpenDeal ? "Open deal →" : "Ledger →"}</Text>
                    </Pressable>
                ) : null}
            </View>

            {featured ? (
                <View style={styles.seal}>
                    <SunMark size={11} />
                    <Text style={styles.sealText}>Sealed by Jua · JuaKali agent</Text>
                </View>
            ) : null}
        </Card>
    );
}

/**
 * Digest bento — one featured artifact + optional side tiles on wide canvases.
 * MengTo / bento lesson: composition over identical stacked cards.
 */
export function DigestBento({
    digests,
    onOpenLedger,
    onOpenDeal,
}: {
    digests: DigestCardData[];
    onOpenLedger?: () => void;
    onOpenDeal?: (commitmentId: string) => void;
}) {
    const { width } = useWindowDimensions();
    const wide = width >= 720;
    if (digests.length === 0) return null;

    const [featured, ...rest] = digests;
    const side = rest.slice(0, 2);

    return (
        <View style={[styles.bento, wide && side.length > 0 && styles.bentoWide]}>
            <View style={wide && side.length > 0 ? styles.featuredCol : undefined}>
                <DigestCard
                    digest={featured!}
                    featured
                    onOpenLedger={onOpenLedger}
                    onOpenDeal={
                        onOpenDeal ? () => onOpenDeal(featured!.commitmentId) : undefined
                    }
                />
            </View>
            {side.length > 0 ? (
                <View style={[styles.sideCol, !wide && styles.sideColStack]}>
                    {side.map((digest) => (
                        <DigestCard
                            key={digest.id}
                            digest={digest}
                            onOpenLedger={onOpenLedger}
                            onOpenDeal={
                                onOpenDeal ? () => onOpenDeal(digest.commitmentId) : undefined
                            }
                        />
                    ))}
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    bento: { gap: space[3], width: "100%" },
    bentoWide: { flexDirection: "row", alignItems: "stretch", gap: space[3] },
    featuredCol: { flex: 1.35, minWidth: 0 },
    sideCol: { flex: 1, gap: space[3], minWidth: 0 },
    sideColStack: { width: "100%" },

    card: { gap: space[3] },
    cardFeatured: { minHeight: 220 },
    top: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        gap: space[2],
    },
    titleRow: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1, minWidth: 0 },
    title: {
        fontFamily: font.displayMedium,
        fontSize: 18,
        fontWeight: "600",
        color: color.charcoal,
        letterSpacing: -0.3,
        flexShrink: 1,
    },
    titleCompact: { fontSize: 15 },
    when: {
        fontFamily: font.bodyBold,
        fontSize: 11,
        fontWeight: "700",
        color: color.mistSoft,
    },
    summary: {
        fontFamily: font.body,
        fontSize: 14,
        lineHeight: 21,
        color: color.ink,
    },
    summaryFeatured: { fontSize: 15, lineHeight: 23 },
    rule: { height: 1, backgroundColor: color.line },
    bentoGrid: { gap: space[3] },
    bentoCell: {
        gap: 4,
        padding: space[3],
        borderRadius: radius.sm,
        backgroundColor: color.stone,
        borderWidth: 1,
        borderColor: color.line,
    },
    bentoCellNext: {
        backgroundColor: color.brassSoft,
        borderColor: color.brassBorder,
    },
    cellLabel: {
        fontFamily: font.bodyBold,
        fontSize: 9,
        fontWeight: "700",
        letterSpacing: 0.8,
        textTransform: "uppercase",
        color: color.brassDeep,
    },
    cellBody: { fontFamily: font.body, fontSize: 13, lineHeight: 19, color: color.ink },
    foot: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: space[2],
    },
    evidenceRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", flex: 1 },
    chip: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: radius.xs,
        backgroundColor: color.brassSoft,
        borderWidth: 1,
        borderColor: color.brassBorder,
    },
    chipText: {
        fontFamily: font.bodyBold,
        fontSize: 10,
        fontWeight: "700",
        letterSpacing: 0.4,
        textTransform: "uppercase",
        color: color.brassDeep,
    },
    link: {
        fontFamily: font.bodyBold,
        fontSize: 12,
        fontWeight: "700",
        color: color.brassDeep,
    },
    seal: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        justifyContent: "center",
        paddingTop: 2,
    },
    sealText: {
        fontFamily: font.bodyMedium,
        fontSize: 10,
        letterSpacing: 0.5,
        textTransform: "uppercase",
        color: color.mistSoft,
    },
});
