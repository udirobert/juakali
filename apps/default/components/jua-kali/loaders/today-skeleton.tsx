import { StyleSheet, View } from "react-native";

import { Skeleton } from "@/components/jua-kali/ui/skeleton";
import { color, layout } from "@/components/jua-kali/theme";
import { useUiMotion } from "@/components/jua-kali/hooks/use-ui-motion";
import Animated from "react-native-reanimated";

/**
 * Branded loading preview for the Today briefing — mirrors the hero (brand row,
 * living sun + greeting) and the section skeletons beneath, so the first frame
 * already locates where each thing will land. No bare spinner.
 */
export function TodaySkeleton() {
    const { enter } = useUiMotion();
    return (
        <View style={styles.screen}>
            <View style={styles.frame}>
                <Animated.View entering={enter(0)}>
                    <Skeleton.Text width={120} height={16} />
                </Animated.View>

                <Animated.View entering={enter(1)} style={styles.hero}>
                    <Skeleton circle height={56} width={56} />
                    <View style={styles.heroCopy}>
                        <Skeleton.Text width={"62%"} height={20} />
                        <Skeleton.Stack lines={2} gap={6} />
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
                    <Skeleton.Stack labelWidth={120} lines={3} gap={10} />
                </Animated.View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: {
        flex: 1,
        alignItems: "center",
        backgroundColor: color.stone,
        paddingTop: 24,
    },
    frame: {
        maxWidth: layout.maxWidth,
        width: "100%",
        alignSelf: "center",
        paddingHorizontal: 16,
        gap: 20,
    },
    hero: { flexDirection: "row", gap: 14, alignItems: "flex-start" },
    heroCopy: { flex: 1, gap: 12 },
});