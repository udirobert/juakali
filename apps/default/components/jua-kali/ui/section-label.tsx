import { StyleSheet, Text } from "react-native";

import { color, font } from "@/components/jua-kali/theme";

/** The eyebrow — a brass-deep small-caps label that opens a section. */
export function SectionLabel({ children }: { children: string }) {
    return <Text style={styles.label}>{children}</Text>;
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
});
