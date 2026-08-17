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

export type AgentSunState = "observing" | "proposing" | "executing" | "verified" | "blocked";

const STATE_PROGRESS: Record<AgentSunState, number> = {
    observing: 0.12,
    proposing: 0.42,
    executing: 0.72,
    verified: 1,
    blocked: 0.22,
};

/**
 * The living sun — brand signature and agent-state language.
 * States: quiet horizon (observing), partial rise (proposing), active rays
 * (executing), sealed noon (verified), interrupted (blocked).
 */
export function LivingSun({
    progress,
    size = 40,
    working = false,
    agentState,
}: {
    /** 0 (dawn) .. 1 (noon). Values outside are clamped. Overridden by agentState when set. */
    progress?: number;
    size?: number;
    /** Gentle core breathing while the agent runs — rests when idle. */
    working?: boolean;
    /** Stateful agent identity — maps to progress + working when provided. */
    agentState?: AgentSunState;
}) {
    const reduceMotion = useReducedMotion();
    const resolvedProgress =
        agentState != null ? STATE_PROGRESS[agentState] : (progress ?? 0.3);
    const resolvedWorking = agentState === "executing" || working;
    const rayCount = agentState === "blocked" ? 6 : RAY_COUNT;
    const p = useSharedValue(resolvedProgress);
    const pulse = useSharedValue(0);

    useEffect(() => {
        const target = Math.min(1, Math.max(0, resolvedProgress));
        p.value = reduceMotion
            ? withTiming(target, { duration: 1 })
            : withSpring(target, { damping: 14, stiffness: 90, mass: 0.9 });
    }, [resolvedProgress, reduceMotion, p]);

    useEffect(() => {
        if (resolvedWorking && !reduceMotion) {
            pulse.value = withRepeat(withTiming(1, { duration: 1100 }), -1, true);
        } else {
            pulse.value = withTiming(0, { duration: 200 });
        }
    }, [resolvedWorking, reduceMotion, pulse]);

    const c = size / 2;
    const baseDotR = size * 0.19;
    const gap = size * 0.045;
    const maxRay = size * 0.2;
    const rayW = Math.max(1.5, size * 0.05);

    return (
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" accessibilityElementsHidden>
            {Array.from({ length: rayCount }, (_, i) => (
                <SunRay
                    key={i}
                    index={i}
                    rayCount={rayCount}
                    progress={p}
                    pulse={pulse}
                    center={c}
                    dotR={baseDotR}
                    gap={gap}
                    maxRay={maxRay}
                    rayW={rayW}
                    eclipsed={agentState === "blocked"}
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
    rayCount,
    progress,
    pulse,
    center,
    dotR,
    gap,
    maxRay,
    rayW,
    eclipsed,
}: {
    index: number;
    rayCount: number;
    progress: SharedValue<number>;
    pulse: SharedValue<number>;
    center: number;
    dotR: number;
    gap: number;
    maxRay: number;
    rayW: number;
    eclipsed?: boolean;
}) {
    const animatedProps = useAnimatedProps(() => {
        const colorStops = interpolateColor(progress.value, [0, 0.5, 1], [sun.dawn, sun.rising, sun.noon]);
        const litFraction = eclipsed ? 0.15 : 0.25 + 0.75 * progress.value;
        const lit = Math.min(1, Math.max(0, litFraction * rayCount - index));
        const angle = ((index * (360 / rayCount) - 90) * Math.PI) / 180;
        const r1 = dotR + gap;
        if (lit <= 0.01) {
            return { x1: center, y1: center, x2: center, y2: center, opacity: 0, stroke: colorStops };
        }
        const globalScale = 0.8 + 0.2 * progress.value;
        const len = maxRay * globalScale * (0.55 + 0.45 * lit) * (1 + 0.12 * pulse.value) * (eclipsed ? 0.55 : 1);
        const r2 = r1 + len;
        return {
            x1: center + Math.cos(angle) * r1,
            y1: center + Math.sin(angle) * r1,
            x2: center + Math.cos(angle) * r2,
            y2: center + Math.sin(angle) * r2,
            opacity: (0.35 + 0.65 * lit) * (eclipsed ? 0.45 : 1),
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
