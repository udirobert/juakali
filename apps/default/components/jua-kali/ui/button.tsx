import { type ReactNode } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, View } from "react-native";

import { color, font, radius } from "@/components/jua-kali/theme";
import { PressableScale } from "@/components/jua-kali/ui/pressable-scale";

/**
 * The app's button. Three variants, one meaning each:
 *  · primary — charcoal; ordinary navigation/creation.
 *  · approve — brass; the trust/permission color. Consequential acts only.
 *  · ghost   — paper + hairline; secondary actions.
 *
 * Soft top-edge light (sylva dock rim) keeps fills from reading as plastic slabs.
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
            style={[
                styles.base,
                !isGhost && styles.minHeight,
                isApprove && styles.approve,
                isGhost && styles.ghost,
                style,
            ]}
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

const rim = Platform.select({
    web: {
        backgroundImage:
            "linear-gradient(180deg, rgba(255,253,247,0.14), rgba(255,253,247,0) 42%)",
    },
    default: {},
});

const styles = StyleSheet.create({
    base: {
        paddingHorizontal: 18,
        paddingVertical: 13,
        borderRadius: radius.md,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: color.charcoal,
        ...rim,
    },
    minHeight: { minHeight: 46 },
    approve: {
        backgroundColor: color.brass,
        paddingVertical: 14,
        minHeight: 48,
    },
    ghost: {
        backgroundColor: color.paper,
        borderWidth: 1,
        borderColor: color.lineStrong,
        backgroundImage: undefined,
    },
    row: { flexDirection: "row", alignItems: "center", gap: 8 },
    label: {
        fontFamily: font.bodyBold,
        color: color.foam,
        fontWeight: "700",
        fontSize: 13,
        letterSpacing: 0.2,
    },
    labelApprove: { fontSize: 14, letterSpacing: 0.3 },
    labelGhost: { color: color.charcoal },
});
