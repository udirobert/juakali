import { createContext, useContext, useEffect, type ReactNode } from "react";
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
    Easing,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withRepeat,
    withTiming,
    type SharedValue,
} from "react-native-reanimated";

import { color, motion } from "@/components/jua-kali/theme";

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
 *  · SkeletonPulse  — wrap a whole skeleton tree so every block breathes on
 *                     ONE shared animation instead of one per block
 */

const PulseContext = createContext<SharedValue<number> | null>(null);

/**
 * One breathing pulse for an entire skeleton tree. Every Skeleton inside reads
 * the same shared value, so a full-page skeleton runs a single UI-thread
 * animation instead of ~25 parallel ones (ledger boot). Skeletons rendered
 * outside a provider still pulse on their own.
 */
export function SkeletonPulse({ children }: { children: ReactNode }) {
    const pulse = usePulse();
    return <PulseContext.Provider value={pulse}>{children}</PulseContext.Provider>;
}

type SkeletonProps = {
    width?: DimensionValue;
    height?: number;
    radius?: number;
    circle?: boolean;
    style?: StyleProp<ViewStyle>;
};

function SkeletonBase(props: SkeletonProps) {
    const shared = useContext(PulseContext);
    return shared ? <SkeletonBlock {...props} pulse={shared} /> : <SkeletonSelfPulsing {...props} />;
}

function SkeletonSelfPulsing(props: SkeletonProps) {
    const pulse = usePulse();
    return <SkeletonBlock {...props} pulse={pulse} />;
}

function SkeletonBlock({
    width,
    height = 12,
    radius = 5,
    circle = false,
    style,
    pulse,
}: SkeletonProps & { pulse: SharedValue<number> }) {
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

function SkeletonText({
    width,
    height = 12,
    style,
}: {
    width?: DimensionValue;
    height?: number;
    style?: StyleProp<ViewStyle>;
}) {
    return <SkeletonBase width={width} height={height} style={style} />;
}

/** A labelled column of text lines (mirrors a SectionLabel + body paragraph). */
function SkeletonStack({
    labelWidth = 84,
    labelHeight = 9,
    lines = 2,
    lastWidth = "62%",
    lineHeight = 12,
    gap = 8,
    style,
}: {
    labelWidth?: number;
    labelHeight?: number;
    lines?: number;
    lastWidth?: DimensionValue;
    lineHeight?: number;
    gap?: number;
    style?: StyleProp<ViewStyle>;
}) {
    return (
        <View style={[{ gap }, style]}>
            <SkeletonText width={labelWidth} height={labelHeight} />
            {Array.from({ length: lines }, (_, i) => (
                <SkeletonText key={i} width={i === lines - 1 ? lastWidth : "100%"} height={lineHeight} />
            ))}
        </View>
    );
}

// Dot-notation statics via Object.assign instead of a TS namespace — same
// `Skeleton.Text` / `Skeleton.Stack` call sites, lint-clean, Metro-safe.
export const Skeleton = Object.assign(SkeletonBase, {
    Text: SkeletonText,
    Stack: SkeletonStack,
});

/** Shared impossible-pulse driver. */
function usePulse() {
    const reduce = useReducedMotion() ?? false;
    const pulse = useSharedValue(0.5);
    useEffect(() => {
        if (reduce) {
            pulse.value = 0.55;
            return;
        }
        pulse.value = withRepeat(
            withTiming(1, { duration: motion.skeletonPulse, easing: Easing.inOut(Easing.ease) }),
            -1,
            true
        );
        return () => undefined;
    }, [reduce, pulse]);
    return pulse;
}

const styles = StyleSheet.create({
    block: {
        backgroundColor: color.lineStrong,
    },
});
