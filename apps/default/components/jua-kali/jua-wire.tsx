import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
    FadeIn,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withRepeat,
    withTiming,
} from "react-native-reanimated";

import { LivingSun, type AgentSunState } from "@/components/jua-kali/living-sun";
import { color, font, motion, radius, space } from "@/components/jua-kali/theme";

/**
 * The Wire — Jua's live presence as theater grounded in real agent state.
 * Not a chat bubble: a desk instrument that says the agent is already working
 * the portfolio. Ambition: the first thing you feel is that something alive
 * is watching the deals with you.
 */
export function JuaWire({
    agentState,
    line,
    meta,
}: {
    agentState: AgentSunState;
    /** First-person utterance — what Jua is doing / wants. */
    line: string;
    /** Compact facts: "last worked · 4 runs · next digest Fri". */
    meta?: string | null;
}) {
    const reduceMotion = useReducedMotion();
    const pulse = useSharedValue(0);

    useEffect(() => {
        if (reduceMotion || agentState === "observing" || agentState === "verified") {
            pulse.value = withTiming(0, { duration: 200 });
            return;
        }
        pulse.value = withRepeat(withTiming(1, { duration: 1600 }), -1, true);
    }, [agentState, reduceMotion, pulse]);

    const haloStyle = useAnimatedStyle(() => ({
        opacity: 0.25 + 0.35 * pulse.value,
        transform: [{ scale: 1 + 0.06 * pulse.value }],
    }));

    const stateLabel =
        agentState === "executing"
            ? "Working now"
            : agentState === "proposing"
              ? "Needs you"
              : agentState === "blocked"
                ? "Paused"
                : agentState === "verified"
                  ? "Sealed"
                  : "Watching";

    return (
        <Animated.View
            entering={reduceMotion ? undefined : FadeIn.duration(motion.slow)}
            style={styles.wire}
            accessibilityRole="summary"
            accessibilityLabel={`Jua · ${stateLabel}. ${line}`}
        >
            <View style={styles.sunWell}>
                {(agentState === "executing" || agentState === "proposing") && !reduceMotion ? (
                    <Animated.View style={[styles.halo, haloStyle]} />
                ) : null}
                <LivingSun size={44} agentState={agentState} />
            </View>
            <View style={styles.copy}>
                <View style={styles.stateRow}>
                    <View
                        style={[
                            styles.dot,
                            agentState === "executing" && styles.dotLive,
                            agentState === "proposing" && styles.dotNeed,
                            agentState === "blocked" && styles.dotBlocked,
                        ]}
                    />
                    <Text style={styles.state}>{stateLabel}</Text>
                    <Text style={styles.agent}>Jua</Text>
                </View>
                <Text style={styles.line} numberOfLines={3}>
                    {line}
                </Text>
                {meta ? <Text style={styles.meta}>{meta}</Text> : null}
            </View>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    wire: {
        flexDirection: "row",
        alignItems: "center",
        gap: space[4],
        paddingVertical: space[4],
        paddingHorizontal: space[4],
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: color.brassBorder,
        backgroundColor: color.foam,
        overflow: "hidden",
    },
    sunWell: {
        width: 56,
        height: 56,
        alignItems: "center",
        justifyContent: "center",
    },
    halo: {
        position: "absolute",
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: color.brassSoft,
        borderWidth: 1,
        borderColor: color.brassBorder,
    },
    copy: { flex: 1, gap: 4, minWidth: 0 },
    stateRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    dot: {
        width: 7,
        height: 7,
        borderRadius: 4,
        backgroundColor: color.mist,
    },
    dotLive: { backgroundColor: color.brass },
    dotNeed: { backgroundColor: color.brassDeep },
    dotBlocked: { backgroundColor: color.danger },
    state: {
        fontFamily: font.bodyBold,
        fontSize: 10,
        fontWeight: "700",
        letterSpacing: 1.2,
        textTransform: "uppercase",
        color: color.brassDeep,
    },
    agent: {
        fontFamily: font.bodyMedium,
        fontSize: 11,
        color: color.mistSoft,
        marginLeft: "auto",
    },
    line: {
        fontFamily: font.displayMedium,
        fontSize: 17,
        fontWeight: "600",
        letterSpacing: -0.3,
        lineHeight: 23,
        color: color.charcoal,
    },
    meta: {
        fontFamily: font.body,
        fontSize: 12,
        lineHeight: 17,
        color: color.mist,
        marginTop: 2,
    },
});
