import { StyleSheet, Text, View } from "react-native";

import { LedgerPrintImage } from "@/components/jua-kali/ledger-print-image";
import { color, type as typeStyle } from "@/components/jua-kali/theme";

/**
 * The field print strip — the public ledger's atmosphere. Jua kali field
 * work rendered as halftone plates: the page stops being a screen and reads
 * as the printed public record it claims to be. Photos are illustrative
 * (Wikimedia Commons, CC BY-SA) — never passed off as venture evidence.
 * Web-only: the treatment is a canvas detail; native shows the ledger clean.
 */

const PLATE_ASPECT = 4 / 3;
const FIELD_PHOTOS = [
    { uri: "/field/welding.jpg", alt: "Welder at work, printed as ledger halftone" },
    { uri: "/field/artisans.jpg", alt: "Jua kali artisans, printed as ledger halftone" },
    { uri: "/field/carpenter.jpg", alt: "Carpenter's workshop, printed as ledger halftone" },
];

export function FieldPrintStrip() {
    if (process.env.EXPO_OS !== "web") return null;
    return (
        <View style={styles.strip}>
            <View style={styles.photos}>
                {FIELD_PHOTOS.map((photo, i) => (
                    <View key={photo.uri} style={styles.photo}>
                        <LedgerPrintImage
                            uri={photo.uri}
                            ink="charcoal"
                            cell={3}
                            animate
                            sweepSeconds={2.2 + i * 0.4}
                            aspectRatio={PLATE_ASPECT}
                            alt={photo.alt}
                        />
                    </View>
                ))}
            </View>
            <Text style={styles.caption}>
                Field work, printed to the ledger — evidence reads as print, not pixels. Photos:
                Wikimedia Commons (CC BY-SA).
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    strip: { gap: 8 },
    photos: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
    photo: { flex: 1 },
    caption: {
        ...typeStyle.meta,
        fontSize: 10,
        lineHeight: 14,
        color: color.mistSoft,
    },
});
