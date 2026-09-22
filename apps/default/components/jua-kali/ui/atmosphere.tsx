import { type ReactNode } from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { atmosphere, color } from "@/components/jua-kali/theme";

/**
 * Page atmosphere — sylva's transferable lesson without the dark moss world:
 * modelling comes from light pools over a field, not a flat fill. On native
 * we keep a solid stone base (gradients are thinner there); on web we paint
 * the radial wash + a whisper of grain so fiduciary surfaces still feel alive.
 */
export function Atmosphere({
    variant = "app",
    style,
    children,
}: {
    variant?: "app" | "landing";
    style?: StyleProp<ViewStyle>;
    children: ReactNode;
}) {
    return (
        <View style={[styles.root, style]}>
            {Platform.OS === "web" ? (
                <View
                    pointerEvents="none"
                    style={[
                        styles.wash,
                        { experimental_backgroundImage: atmosphere[variant] } as ViewStyle,
                        // RN-web accepts backgroundImage via style on web.
                        Platform.select({
                            web: { backgroundImage: atmosphere[variant] } as ViewStyle,
                            default: {},
                        }),
                    ]}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                />
            ) : null}
            {Platform.OS === "web" ? (
                <View
                    pointerEvents="none"
                    style={styles.grain}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                />
            ) : null}
            <View style={styles.content}>{children}</View>
        </View>
    );
}

const grainSvg =
    "url(\"data:image/svg+xml;utf8," +
    encodeURIComponent(
        `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>` +
            `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter>` +
            `<rect width='100%' height='100%' filter='url(%23n)' opacity='0.55'/></svg>`
    ) +
    "\")";

const styles = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: color.stone,
        position: "relative",
        overflow: "hidden",
    },
    wash: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: color.stone,
    },
    grain: Platform.select({
        web: {
            ...StyleSheet.absoluteFillObject,
            opacity: 0.035,
            backgroundImage: grainSvg,
            backgroundRepeat: "repeat",
            backgroundSize: "160px 160px",
            mixBlendMode: "multiply",
        } as ViewStyle,
        default: {},
    }),
    content: { flex: 1, zIndex: 1 },
});
