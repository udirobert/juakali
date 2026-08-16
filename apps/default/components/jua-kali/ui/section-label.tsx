import { StyleSheet, Text } from "react-native";

import { color, font, lab } from "@/components/jua-kali/theme";

/**
 * The eyebrow — a brass-deep small-caps label that opens a section. The `lab`
 * variant restyles it in the neutral "system" tone (theme.lab) for operator
 * faces, so functional tooling reads as system rather than investor theater.
 */
export function SectionLabel({ children, variant = "section" }: { children: string; variant?: "section" | "lab" }) {
    return <Text style={[styles.label, variant === "lab" && styles.labelLab]}>{children}</Text>;
}

const styles = StyleSheet.create({
    label: {
        fontFamily: font.bodyBold,
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 1.6,
        textTransform: "uppercase",
        color: color.brassDeep,
    },
    labelLab: {
        color: lab.info,
        letterSpacing: 1.2,
        fontVariant: lab.tabular,
    },
});
