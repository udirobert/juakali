import { Image } from "expo-image";
import type { StyleProp } from "react-native";
import type { ImageStyle } from "expo-image";

/**
 * Native fallback — the halftone treatment is a DOM-canvas effect. On device
 * the photo renders plain; the print metaphor is a web build detail.
 */
export function LedgerPrintImage({
    uri,
    aspectRatio,
    alt = "Field photo",
    style,
}: {
    uri: string;
    ink?: "charcoal" | "brass";
    cell?: number;
    animate?: boolean;
    sweepSeconds?: number;
    aspectRatio?: number;
    alt?: string;
    style?: StyleProp<ImageStyle>;
}) {
    return (
        <Image
            source={{ uri }}
            style={[{ width: "100%", aspectRatio: aspectRatio ?? 1.5, borderRadius: 4 }, style]}
            accessibilityLabel={alt}
            contentFit="cover"
        />
    );
}
