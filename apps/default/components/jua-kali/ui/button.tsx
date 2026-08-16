import { type ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { color, font } from "@/components/jua-kali/theme";
import { PressableScale } from "@/components/jua-kali/ui/pressable-scale";

/**
 * The app's button. Three variants, one meaning each:
 *  · primary — charcoal; ordinary navigation/creation.
 *  · approve — brass; the trust/permission color. Consequential acts only.
 *  · ghost   — paper + hairline; secondary actions.
 */
export function Button({
    label,
    onPress,
    variant = "primary",
    disabled,
    busy,
    icon,
    style,
    accessibilityLabel,
    accessibilityHint,
}: {
    label: string;
    onPress: () => void;
    variant?: "primary" | "approve" | "ghost";
    disabled?: boolean;
    busy?: boolean;
    /** Trailing glyph (e.g. IconArrowRight) rendered after the label. */
    icon?: ReactNode;
    style?: object | object[];
    accessibilityLabel?: string;
    accessibilityHint?: string;
}) {
    const isApprove = variant === "approve";
    const isGhost = variant === "ghost";
    return (
        <PressableScale
            onPress={onPress}
            disabled={disabled || busy}
            style={[styles.base, !isGhost && styles.minHeight, isApprove && styles.approve, isGhost && styles.ghost, style]}
            accessibilityLabel={accessibilityLabel ?? label}
            accessibilityHint={accessibilityHint}
        >
            {busy ? (
                <ActivityIndicator color={isGhost ? color.charcoal : color.paper} />
            ) : (
                <View style={styles.row}>
                    <Text style={[styles.label, isGhost && styles.labelGhost, isApprove && styles.labelApprove]}>
                        {label}
                    </Text>
                    {icon}
                </View>
            )}
        </PressableScale>
    );
}

const styles = StyleSheet.create({
    base: {
        paddingHorizontal: 18,
        paddingVertical: 12,
        borderRadius: 4,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: color.charcoal,
    },
    minHeight: { minHeight: 44 },
    approve: {
        backgroundColor: color.brass,
        paddingVertical: 13,
        minHeight: 46,
    },
    ghost: {
        backgroundColor: color.paper,
        borderWidth: 1,
        borderColor: color.lineStrong,
    },
    row: { flexDirection: "row", alignItems: "center", gap: 8 },
    label: {
        fontFamily: font.bodyBold,
        color: color.paper,
        fontWeight: "700",
        fontSize: 13,
    },
    labelApprove: { fontSize: 14, letterSpacing: 0.3 },
    labelGhost: { color: color.charcoal },
});
