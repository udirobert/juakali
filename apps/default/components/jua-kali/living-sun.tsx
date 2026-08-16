import { useEffect } from "react";
import Svg, { Circle, Line } from "react-native-svg";
import Animated, {
    interpolateColor,
    useAnimatedProps,
    useReducedMotion,
    useSharedValue,
    withRepeat,
    withSpring,
    withTiming,
    type SharedValue,
} from "react-native-reanimated";

import { sun } from "@/components/jua-kali/theme";

const AnimatedLine = Animated.createAnimatedComponent(Line);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const RAY_COUNT = 12;

/**
 * The living sun — the brand's signature system. A venture's sun rises as it
 * proves itself: `progress` 0 = dawn (a few short rays, deep brass), 1 = high
 * noon (twelve full rays, light brass). Ray ignition, core growth, and color
 * all derive from the single progress value, so every surface tells the same
 * story of the entrepreneur's evolution.
 *
 * Springs only on progress change; reduced motion snaps between states.
 */
export function LivingSun({
    progress,
    size = 40,
    working = false,
}: {
    /** 0 (dawn) .. 1 (noon). Values outside are clamped. */
    progress: number;
    size?: number;
    /** Gentle core breathing while the agent runs — rests when idle. */
    working?: boolean;
}) {
    const reduceMotion = useReducedMotion();
    const p = useSharedValue(progress);
    const pulse = useSharedValue(0);

    useEffect(() => {
        const target = Math.min(1, Math.max(0, progress));
        p.value = reduceMotion
            ? withTiming(target, { duration: 1 })
            : withSpring(target, { damping: 14, stiffness: 90, mass: 0.9 });
    }, [progress, reduceMotion, p]);

    useEffect(() => {
        if (working && !reduceMotion) {
            pulse.value = withRepeat(withTiming(1, { duration: 1100 }), -1, true);
        } else {
            pulse.value = withTiming(0, { duration: 200 });
        }
    }, [working, reduceMotion, pulse]);

    const c = size / 2;
    const baseDotR = size * 0.19;
    const gap = size * 0.045;
    const maxRay = size * 0.2;
    const rayW = Math.max(1.5, size * 0.05);

    return (
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" accessibilityElementsHidden>
            {Array.from({ length: RAY_COUNT }, (_, i) => (
                <SunRay
                    key={i}
                    index={i}
                    progress={p}
                    pulse={pulse}
                    center={c}
                    dotR={baseDotR}
                    gap={gap}
                    maxRay={maxRay}
                    rayW={rayW}
                />
            ))}
            <AnimatedCircle
                cx={c}
                cy={c}
                r={baseDotR}
                fill={sun.rising}
                animatedProps={useAnimatedProps(() => {
                    const colorStops = interpolateColor(
                        p.value,
                        [0, 0.5, 1],
                        [sun.dawn, sun.rising, sun.noon],
                    );
                    const growth = 0.16 + 0.05 * p.value;
                    const breathe = 1 + 0.09 * pulse.value;
                    return { r: size * growth * breathe, fill: colorStops };
                })}
            />
        </Svg>
    );
}

function SunRay({
    index,
    progress,
    pulse,
    center,
    dotR,
    gap,
    maxRay,
    rayW,
}: {
    index: number;
    progress: SharedValue<number>;
    pulse: SharedValue<number>;
    center: number;
    dotR: number;
    gap: number;
    maxRay: number;
    rayW: number;
}) {
    const animatedProps = useAnimatedProps(() => {
        // Dawn keeps a sparse corona (25% lit); noon ignites all twelve rays.
        const colorStops = interpolateColor(progress.value, [0, 0.5, 1], [sun.dawn, sun.rising, sun.noon]);
        const litFraction = 0.25 + 0.75 * progress.value;
        const lit = Math.min(1, Math.max(0, litFraction * RAY_COUNT - index));
        const angle = ((index * (360 / RAY_COUNT) - 90) * Math.PI) / 180;
        const r1 = dotR + gap;
        if (lit <= 0.01) {
            return { x1: center, y1: center, x2: center, y2: center, opacity: 0, stroke: colorStops };
        }
        const globalScale = 0.8 + 0.2 * progress.value;
        const len = maxRay * globalScale * (0.55 + 0.45 * lit) * (1 + 0.12 * pulse.value);
        const r2 = r1 + len;
        return {
            x1: center + Math.cos(angle) * r1,
            y1: center + Math.sin(angle) * r1,
            x2: center + Math.cos(angle) * r2,
            y2: center + Math.sin(angle) * r2,
            opacity: 0.35 + 0.65 * lit,
            stroke: colorStops,
        };
    });

    return (
        <AnimatedLine
            x1={center}
            y1={center}
            x2={center}
            y2={center}
            stroke={sun.rising}
            strokeWidth={rayW}
            strokeLinecap="round"
            animatedProps={animatedProps}
        />
    );
}
