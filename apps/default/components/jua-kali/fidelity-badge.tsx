import { Pressable, StyleSheet, Text, View } from "react-native";

import type { ProductMode } from "@/lib/product-mode";
import { color, font } from "@/components/jua-kali/theme";

export function FidelityBadge({
    mode,
    onPress,
    compact,
}: {
    mode: ProductMode;
    onPress?: () => void;
    compact?: boolean;
}) {
    if (!mode.showFidelityBadge) return null;

    const body = (
        <View style={[styles.wrap, compact && styles.wrapCompact]} accessibilityRole="text">
            <Text style={styles.badge}>{mode.fidelityBadge}</Text>
            {!compact ? <Text style={styles.hint}>{mode.fidelityHint}</Text> : null}
        </View>
    );

    if (!onPress) return body;

    return (
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={mode.fidelityHint}>
            {body}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    wrap: {
        gap: 4,
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: color.lineStrong,
        backgroundColor: color.paper,
        maxWidth: 320,
    },
    wrapCompact: {
        paddingVertical: 4,
        paddingHorizontal: 8,
        maxWidth: 200,
    },
    badge: {
        fontFamily: font.bodyBold,
        fontSize: 10,
        fontWeight: "700",
        letterSpacing: 0.6,
        textTransform: "uppercase",
        color: color.brassDeep,
    },
    hint: {
        fontFamily: font.body,
        fontSize: 11,
        lineHeight: 15,
        color: color.mist,
    },
});
