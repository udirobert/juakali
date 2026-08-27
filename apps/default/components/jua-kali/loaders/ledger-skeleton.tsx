import { StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Skeleton, SkeletonPulse } from "@/components/jua-kali/ui/skeleton";
import { color, layout } from "@/components/jua-kali/theme";
import { useUiMotion } from "@/components/jua-kali/hooks/use-ui-motion";
import Animated from "react-native-reanimated";

/**
 * Branded loading preview for the public ledger — mirrors the hero (mark, title,
 * total, stat row) then a stack of feed rows, so the timeline's shape is in place
 * before the events stream in. No bare spinner.
 *
 * The chrome (status-bar inset, responsive gutter) is derived exactly as
 * `PublicLedger` derives it, so the skeleton → ledger swap paints in place.
 * Block heights track the ledger's real type line-heights (title 34 ⇢ 40,
 * total 40 ⇢ 48, sub 13 ⇢ 18, stats ⇢ 16) so content swaps without vertical jump.
 */
export function LedgerSkeleton() {
    const { enter } = useUiMotion();
    const insets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    // Same clamp PublicLedger uses for its content gutter.
    const padX = Math.max(14, Math.min(28, (width - layout.maxWidth) / 2 + 16));
    return (
        // insets.top + 8 mirrors the screen's own top inset plus styles.content padding.
        <SkeletonPulse>
        <View
            style={[styles.screen, { paddingTop: insets.top + 8 }]}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel="Loading the public ledger"
        >
            <View style={[styles.frame, { paddingHorizontal: padX }]}>
                <Animated.View entering={enter(0)} style={styles.hero}>
                    <Skeleton circle height={28} width={28} />
                    <Skeleton.Text width={200} height={40} />
                    <Skeleton.Text width={"72%"} height={18} />
                    <Skeleton.Text width={"58%"} height={18} />
                    <Skeleton.Text width={184} height={48} />
                    <Skeleton.Text width={"46%"} height={16} />
                    <View style={styles.stats}>
                        <Skeleton.Text width={96} height={16} />
                        <Skeleton.Text width={60} height={16} />
                        <Skeleton.Text width={80} height={16} />
                    </View>
                </Animated.View>

                <Animated.View entering={enter(1)} style={styles.feed}>
                    {[0, 1, 2, 3].map((i) => (
                        <View key={i} style={styles.row}>
                            <View style={styles.rowTop}>
                                <Skeleton.Text width={88} height={11} />
                                <Skeleton.Text width={72} height={11} />
                            </View>
                            <Skeleton.Text width={"94%"} height={20} />
                            <Skeleton.Text width={"68%"} height={20} />
                        </View>
                    ))}
                </Animated.View>
            </View>
        </View>
        </SkeletonPulse>
    );
}

const styles = StyleSheet.create({
    screen: {
        flex: 1,
        alignItems: "center",
        backgroundColor: color.stone,
    },
    frame: {
        maxWidth: layout.maxWidth,
        width: "100%",
        alignSelf: "center",
        gap: 16,
    },
    hero: { alignItems: "center", gap: 10, paddingBottom: 2 },
    stats: { flexDirection: "row", gap: 12, marginTop: 2 },
    feed: {
        backgroundColor: color.paper,
        borderWidth: 1,
        borderColor: color.line,
        borderRadius: 6,
        paddingHorizontal: 14,
    },
    row: {
        gap: 4,
        paddingVertical: 12,
        borderTopWidth: 1,
        borderTopColor: color.line,
    },
    rowTop: { flexDirection: "row", justifyContent: "space-between" },
});
