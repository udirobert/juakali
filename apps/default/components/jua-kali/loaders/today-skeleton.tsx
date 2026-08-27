import { StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Skeleton, SkeletonPulse } from "@/components/jua-kali/ui/skeleton";
import { color, layout } from "@/components/jua-kali/theme";
import { useUiMotion } from "@/components/jua-kali/hooks/use-ui-motion";
import Animated from "react-native-reanimated";

/**
 * Branded loading preview for the Today briefing — mirrors the hero (brand row,
 * living sun + greeting) and the section skeletons beneath, so the first frame
 * already locates where each thing will land. No bare spinner.
 *
 * The chrome (safe-area inset, responsive gutter) is derived exactly as
 * `TodayBriefing` derives it, so the skeleton → briefing swap paints in place.
 * Block heights track the briefing's real type line-heights (brand 28 ⇢ 30,
 * greeting 32, briefing copy 26, section body 22) so the swap doesn't jump.
 */
export function TodaySkeleton() {
    const { enter } = useUiMotion();
    const insets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    // Same clamp TodayBriefing uses for its content gutter.
    const padX = Math.max(14, Math.min(28, (width - layout.maxWidth) / 2 + 16));
    return (
        // insets.top + 16 is the briefing's own scroll padding (branded header).
        <SkeletonPulse>
        <View
            style={[styles.screen, { paddingTop: insets.top + 16 }]}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel="Loading the Today briefing"
        >
            <View style={[styles.frame, { paddingHorizontal: padX }]}>
                <Animated.View entering={enter(0)}>
                    <Skeleton.Text width={140} height={30} />
                </Animated.View>

                <Animated.View entering={enter(1)} style={styles.hero}>
                    <Skeleton circle height={56} width={56} />
                    <View style={styles.heroCopy}>
                        <Skeleton.Text width={"62%"} height={32} />
                        <Skeleton.Stack lines={2} gap={6} lineHeight={26} />
                    </View>
                </Animated.View>

                {/* How-it-works / coach card */}
                <Animated.View entering={enter(2)}>
                    <Skeleton height={132} radius={6} />
                </Animated.View>

                {/* Possible decision card */}
                <Animated.View entering={enter(3)}>
                    <Skeleton height={150} radius={6} />
                </Animated.View>

                <Animated.View entering={enter(4)}>
                    <Skeleton.Stack labelWidth={120} lines={3} gap={10} lineHeight={22} />
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
        gap: 20,
    },
    hero: { flexDirection: "row", gap: 14, alignItems: "flex-start" },
    heroCopy: { flex: 1, gap: 12 },
});
