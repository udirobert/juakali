import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle as SvgCircle, Path as SvgPath } from "react-native-svg";
import Animated, {
    useAnimatedProps,
    useReducedMotion,
    useSharedValue,
    withTiming,
} from "react-native-reanimated";

import { color } from "@/components/jua-kali/theme";

const AnimatedPath = Animated.createAnimatedComponent(SvgPath);

/**
 * The KPI line — a real drawn sparkline instead of bars. The line draws
 * itself in when data arrives or changes; the last point lands in brass.
 * Shared by the cockpit scorecard and the empty-desk venture gallery.
 */
export function Sparkline({ values, height = 34 }: { values: number[]; height?: number }) {
    const reduceMotion = useReducedMotion();
    const [width, setWidth] = useState(0);
    const pad = 3;

    const recent = values.slice(-14);
    const max = Math.max(...recent, 1);
    const min = Math.min(...recent, 0);
    const range = max - min || 1;

    const points = recent.map((value, index) => ({
        x: pad + (recent.length === 1 ? 0 : (index / (recent.length - 1)) * (width - pad * 2)),
        y: pad + (1 - (value - min) / range) * (height - pad * 2),
    }));

    const pathD = points
        .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
        .join(" ");
    const pathLength = points.reduce(
        (acc, p, i) => (i === 0 ? 0 : acc + Math.hypot(p.x - points[i - 1]!.x, p.y - points[i - 1]!.y)),
        0,
    );

    const dash = useSharedValue(reduceMotion ? 0 : pathLength);
    useEffect(() => {
        if (width <= 0) return;
        if (reduceMotion) {
            dash.value = 0;
            return;
        }
        dash.value = pathLength;
        dash.value = withTiming(0, { duration: 480 });
    }, [pathLength, width, reduceMotion, dash]);

    const animatedProps = useAnimatedProps(() => ({
        strokeDashoffset: dash.value,
    }));

    if (recent.length === 0 || width <= 0) {
        return (
            <View
                style={[styles.track, { height }]}
                onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
            />
        );
    }
    const last = points[points.length - 1]!;

    return (
        <View style={[styles.track, { height }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
            <Svg width={width} height={height}>
                <AnimatedPath
                    d={pathD}
                    fill="none"
                    stroke={color.charcoal}
                    strokeWidth={1.75}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray={`${pathLength} ${pathLength}`}
                    strokeDashoffset={pathLength}
                    animatedProps={animatedProps}
                />
                <SvgCircle cx={last.x} cy={last.y} r={2.6} fill={color.brass} />
            </Svg>
        </View>
    );
}

const styles = StyleSheet.create({
    track: { justifyContent: "center" },
});
