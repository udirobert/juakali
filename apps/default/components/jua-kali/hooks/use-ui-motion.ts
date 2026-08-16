import { FadeIn, FadeInDown, useReducedMotion } from "react-native-reanimated";

import { motion } from "@/components/jua-kali/theme";

/**
 * One shared source of truth for "less motion" across the app. This mirrors
 * the per-file guards already in living-sun / pressable-scale so every
 * authored entrance (a card appearing, the arrival stagger) degrades to
 * instant when the OS asks for less motion — without re-importing
 * `useReducedMotion` and re-inventing the guard in each surface.
 *
 *  · enter(i) — authored stagger (mark + voice + timestamp); snap when reducing.
 *  · down(ms) — quick slide-in for routine cards/gates; snap when reducing.
 *  · fade(ms) — fade-only for list rows/bubbles; snap when reducing.
 */
export function useUiMotion() {
    const reduceMotion = useReducedMotion();
    const enter = (index = 0) =>
        reduceMotion ? undefined : FadeInDown.duration(motion.base).delay(index * motion.stagger);
    const down = (duration = 170) => (reduceMotion ? undefined : FadeInDown.duration(duration));
    const fade = (duration = 160) => (reduceMotion ? undefined : FadeIn.duration(duration));
    return { reduceMotion, enter, down, fade };
}