import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "react-native-reanimated";

/**
 * Numbers that arrive, not jump — an eased count-up for headline figures
 * (pledged totals, metrics). Reduced motion lands on the final value
 * immediately.
 */
export function useCountUp(target: number, durationMs = 700): number {
    const reduceMotion = useReducedMotion() ?? false;
    const [value, setValue] = useState(target);
    const currentRef = useRef(target);

    useEffect(() => {
        if (reduceMotion || durationMs <= 0) {
            currentRef.current = target;
            setValue(target);
            return;
        }
        const from = currentRef.current;
        if (from === target) return;
        const start = performance.now();
        let raf = 0;
        const tick = (now: number) => {
            const t = Math.min(1, (now - start) / durationMs);
            const eased = 1 - Math.pow(1 - t, 3);
            const next = from + (target - from) * eased;
            currentRef.current = next;
            setValue(next);
            if (t < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [target, durationMs, reduceMotion]);

    return value;
}
