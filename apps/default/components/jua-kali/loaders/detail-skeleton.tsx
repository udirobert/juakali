import { StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Skeleton } from "@/components/jua-kali/ui/skeleton";
import { color } from "@/components/jua-kali/theme";
import { useUiMotion } from "@/components/jua-kali/hooks/use-ui-motion";

/**
 * Branded loading preview for the scrollable detail screens (proof event, agent
 * run, approval). Mirrors their shared shape — back link, head (living sun +
 * eyebrow/title), body paragraph, meta, then a section with stacked rows — so
 * the slide transition lands on a meaningful first paint instead of a bare
 * spinner. `header` opts out of the top inset for screens whose chrome is the
 * Stack header (approvals).
 */
export function DetailSkeleton({ header = false }: { header?: boolean }) {
    const { enter } = useUiMotion();
    const insets = useSafeAreaInsets();
    return (
        <View style={[styles.screen, { paddingTop: header ? 16 : insets.top + 16 }]}>
            <View style={styles.frame}>
                <Animated.View entering={enter(0)}>
                    <Skeleton.Text width={52} height={14} />
                </Animated.View>

                <Animated.View entering={enter(1)} style={styles.head}>
                    <Skeleton circle height={44} width={44} />
                    <View style={styles.headCopy}>
                        <Skeleton.Text width={92} height={11} />
                        <Skeleton.Text width={"58%"} height={24} />
                    </View>
                </Animated.View>

                <Animated.View entering={enter(2)} style={styles.paragraph}>
                    <Skeleton.Text width={"98%"} height={22} />
                    <Skeleton.Text width={"82%"} height={22} />
                </Animated.View>

                <Animated.View entering={enter(3)}>
                    <Skeleton.Text width={"70%"} height={12} />
                </Animated.View>

                <Animated.View entering={enter(4)} style={styles.section}>
                    <Skeleton.Text width={120} height={11} />
                    {[0, 1, 2].map((i) => (
                        <View key={i} style={styles.row}>
                            <Skeleton height={22} width={22} radius={4} />
                            <View style={styles.rowCopy}>
                                <Skeleton.Text width={"94%"} height={14} />
                                <Skeleton.Text width={"76%"} height={20} />
                                <Skeleton.Text width={"58%"} height={12} />
                            </View>
                        </View>
                    ))}
                </Animated.View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: color.stone,
        paddingHorizontal: 16,
    },
    frame: { gap: 16 },
    head: { flexDirection: "row", gap: 12, alignItems: "center", marginTop: 4 },
    headCopy: { flex: 1, gap: 6 },
    paragraph: { gap: 8 },
    section: { gap: 12, marginTop: 8 },
    row: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
    rowCopy: { flex: 1, gap: 6 },
});
