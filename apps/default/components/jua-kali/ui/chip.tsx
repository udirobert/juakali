import { type ReactNode } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { color, font } from "@/components/jua-kali/theme";

/** Toggle chip — venture/KPI pickers and filters. Selected = brass. */
export function Chip({
    label,
    active,
    onPress,
    leading,
    accessibilityLabel,
}: {
    label: string;
    active: boolean;
    onPress: () => void;
    /** Optional leading glyph. */
    leading?: ReactNode;
    accessibilityLabel?: string;
}) {
    return (
        <Pressable
            onPress={onPress}
            style={[styles.chip, active && styles.on]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={accessibilityLabel ?? label}
        >
            {leading}
            <Text style={[styles.text, active && styles.textOn]}>{label}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    chip: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 4,
        backgroundColor: color.paper,
        borderWidth: 1,
        borderColor: color.line,
    },
    on: { borderColor: color.brass, backgroundColor: color.brassSoft },
    text: { fontFamily: font.bodyBold, fontSize: 12, fontWeight: "700", color: color.ink },
    textOn: { color: color.charcoal },
});
