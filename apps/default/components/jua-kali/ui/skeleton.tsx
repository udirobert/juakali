import { useEffect } from "react";
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
    Easing,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withRepeat,
    withTiming,
} from "react-native-reanimated";

import { color } from "@/components/jua-kali/theme";

/**
 * Skeleton primitives — branded placeholders that preview real layout so the
 * first meaningful frame arrives before data does (fewer layout jumps, no bare
 * spinner in the middle of an empty screen).
 *
 * A soft breath pulse carries the loading cue; it runs on the UI thread, respects
 * `useReducedMotion` (static fill when the OS asks for less motion), and never
 * animates layout — so scroll position holds while data streams in.
 *
 * Composition:
 *  · Skeleton       — one rounded block (line, circle, chip, etc.)
 *  · Skeleton.Text  — a text-line block
 *  · Skeleton.Stack — a labelled column of text lines
 */
export function Skeleton({
    width,
    height = 12,
    radius = 5,
    circle = false,
    style,
}: {
    width?: DimensionValue;
    height?: number;
    radius?: number;
    circle?: boolean;
    style?: StyleProp<ViewStyle>;
}) {
    const pulse = usePulse();
    const anim = useAnimatedStyle(() => ({ opacity: pulse.value }));
    return (
        <Animated.View
            style={[
                styles.block,
                { width: width ?? "100%", height, borderRadius: circle ? height / 2 : radius },
                anim,
                style,
            ]}
        />
    );
}

export namespace Skeleton {
    export function Text({
        width,
        height = 12,
        style,
    }: {
        width?: DimensionValue;
        height?: number;
        style?: StyleProp<ViewStyle>;
    }) {
        return <Skeleton width={width} height={height} style={style} />;
    }

    /** A labelled column of text lines (mirrors a SectionLabel + body paragraph). */
    export function Stack({
        labelWidth = 84,
        lines = 2,
        lastWidth = "62%",
        gap = 8,
        style,
    }: {
        labelWidth?: number;
        lines?: number;
        lastWidth?: DimensionValue;
        gap?: number;
        style?: StyleProp<ViewStyle>;
    }) {
        return (
            <View style={[{ gap }, style]}>
                <Text width={labelWidth} height={9} />
                {Array.from({ length: lines }, (_, i) => (
                    <Text key={i} width={i === lines - 1 ? lastWidth : "100%"} />
                ))}
            </View>
        );
    }
}

/** Shared impossible-pulse driver. */
function usePulse() {
    const reduce = useReducedMotion() ?? false;
    const pulse = useSharedValue(0.5);
    useEffect(() => {
        if (reduce) {
            pulse.value = 0.55;
            return;
        }
        pulse.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }), -1, true);
        return () => undefined;
    }, [reduce, pulse]);
    return pulse;
}

const styles = StyleSheet.create({
    block: {
        backgroundColor: color.lineStrong,
    },
});