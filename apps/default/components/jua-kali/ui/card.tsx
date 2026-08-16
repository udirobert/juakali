import { type ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { color, elevation } from "@/components/jua-kali/theme";

/**
 * The surface system — one card recipe instead of per-file copies.
 *  · default  — paper on a hairline; the everyday surface.
 *  · trust    — brass border; Jua speaking (proposals, arrivals).
 *  · artifact — foam with a brass top rule and a whisper of elevation; things
 *               the agent produced (digests), so they read as documents, not boxes.
 */
export function Card({
    variant = "default",
    style,
    children,
    accessibilityRole,
}: {
    variant?: "default" | "trust" | "artifact";
    style?: StyleProp<ViewStyle>;
    children: ReactNode;
    accessibilityRole?: "text" | "summary" | "none";
}) {
    return (
        <View
            accessibilityRole={accessibilityRole}
            style={[
                styles.base,
                variant === "trust" && styles.trust,
                variant === "artifact" && styles.artifact,
                style,
            ]}
        >
            {variant === "artifact" ? <View style={styles.artifactRule} /> : null}
            {children}
        </View>
    );
}

const styles = StyleSheet.create({
    base: {
        gap: 12,
        padding: 16,
        backgroundColor: color.paper,
        borderWidth: 1,
        borderColor: color.line,
        borderRadius: 6,
    },
    trust: { borderColor: color.brass },
    artifact: {
        backgroundColor: color.foam,
        ...elevation.raised,
    },
    /** The brass rule a digest is filed under. */
    artifactRule: {
        position: "absolute",
        top: -1,
        left: 14,
        right: 14,
        height: 2,
        backgroundColor: color.brass,
        borderTopLeftRadius: 2,
        borderTopRightRadius: 2,
    },
});
