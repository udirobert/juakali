import { useEffect, useRef, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useReducedMotion } from "react-native-reanimated";
import type { AnimatedProps } from "react-native-reanimated";
import type { ViewProps } from "react-native";

import { motion } from "@/components/jua-kali/theme";

/**
 * Scroll-driven reveal — the on-scroll mask/transition idea adapted to a
 * feed: rows below the fold stay settled until they actually reach the
 * viewport, then rise ~16px and fade in once. Web uses IntersectionObserver
 * + a CSS transition on the host node; native falls back to the provided
 * reanimated `entering` (the existing stagger), so behavior is unchanged
 * on device. Honors prefers-reduced-motion by rendering fully present.
 */
export function ScrollReveal({
    children,
    entering,
    delay = 0,
    style,
}: {
    children: ReactNode;
    /** Native fallback entrance (reanimated), ignored on web. */
    entering?: AnimatedProps<ViewProps>["entering"];
    /** Stagger for rows that arrive in view together — ms. */
    delay?: number;
    style?: StyleProp<ViewStyle>;
}) {
    const hostRef = useRef<View>(null);
    const reduceMotion = useReducedMotion();

    useEffect(() => {
        if (process.env.EXPO_OS !== "web") return;
        const el = hostRef.current as unknown as HTMLElement | null;
        if (!el || reduceMotion) return;
        el.style.transition = `opacity ${motion.slow}ms ease ${delay}ms, transform ${motion.slow}ms cubic-bezier(0.22, 0.8, 0.24, 1) ${delay}ms`;
        el.style.opacity = "0";
        el.style.transform = "translateY(16px)";
        const io = new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting)) {
                    io.disconnect();
                    el.style.opacity = "1";
                    el.style.transform = "translateY(0px)";
                }
            },
            { threshold: 0.08 },
        );
        io.observe(el);
        return () => io.disconnect();
    }, [delay, reduceMotion]);

    if (process.env.EXPO_OS !== "web") {
        return (
            <Animated.View entering={entering} style={style}>
                {children}
            </Animated.View>
        );
    }
    return (
        <View ref={hostRef} style={style}>
            {children}
        </View>
    );
}
