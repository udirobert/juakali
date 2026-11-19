import { Platform, Text } from "react-native";

/**
 * Native fallback — the WizardConnect QR renderer is DOM canvas only. On
 * device the wallet pairs via the wiz:// deep link / copied URI instead.
 */
export function BchQr({ value, size = 220 }: { value: string; size?: number }) {
    void size;
    return (
        <Text
            selectable
            style={{
                fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
                fontSize: 11,
            }}
        >
            {value}
        </Text>
    );
}
