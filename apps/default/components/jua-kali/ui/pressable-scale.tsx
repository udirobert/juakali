import { type ReactNode } from "react";
import { Pressable, StyleSheet } from "react-native";
import { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from "react-native-reanimated";
import Animated from "react-native-reanimated";

import { tapHaptic } from "@/components/jua-kali/haptics";
import { motion } from "@/components/jua-kali/theme";

/**
 * Tactile press wrapper — the one press treatment for the whole app: a light
 * selection haptic plus a spring scale to motion.pressScale. Never used for
 * rows or plain links; buttons and cards only.
 */
export function PressableScale({
    onPress,
    disabled,
    style,
    children,
    accessibilityRole = "button",
    accessibilityLabel,
    accessibilityHint,
    hitSlop,
}: {
    onPress: () => void;
    disabled?: boolean;
    style?: object | object[];
    children: ReactNode;
    accessibilityRole?: "button" | "switch" | "tab";
    accessibilityLabel?: string;
    accessibilityHint?: string;
    hitSlop?: number;
}) {
    const reduceMotion = useReducedMotion();
    const scale = useSharedValue(1);
    const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

    return (
        <Pressable
            disabled={disabled}
            onPressIn={() => {
                if (!reduceMotion) scale.value = withSpring(motion.pressScale, { damping: 20, stiffness: 400 });
            }}
            onPressOut={() => {
                if (!reduceMotion) scale.value = withSpring(1, { damping: 18, stiffness: 320 });
            }}
            onPress={() => {
                if (disabled) return;
                // Haptic on commit, not press-in — cancelled presses stay silent.
                tapHaptic();
                onPress();
            }}
            accessibilityRole={accessibilityRole}
            accessibilityLabel={accessibilityLabel}
            accessibilityHint={accessibilityHint}
            hitSlop={hitSlop !== undefined ? hitSlop : undefined}
        >
            <Animated.View style={[style, anim, disabled && styles.disabled]}>{children}</Animated.View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    disabled: { opacity: 0.45 },
});
