import { StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";

import { formatDueLabel, formatKes } from "@/components/jua-kali/cockpit/format";
import { useUiMotion } from "@/components/jua-kali/hooks/use-ui-motion";
import { SunMark } from "@/components/jua-kali/sun-mark";
import { color, font, type } from "@/components/jua-kali/theme";
import { Button, Card } from "@/components/jua-kali/ui";

/**
 * Day zero — the moment right after the first pledge lands, symmetric to the
 * desk-at-dawn empty state. Jua confirms the pledge, names the honest state
 * (nothing is public yet), explains the digest cadence, and points at the one
 * action that starts the loop: the first note.
 */
export function DealDayZero({
    ventureName,
    amountKes,
    digestCadence,
    nextDigestAt,
    onFocusNote,
}: {
    ventureName: string;
    amountKes: number;
    /** e.g. "Weekly · Fri 08:00 EAT" — null falls back to the default cadence. */
    digestCadence: string | null;
    nextDigestAt: number | null;
    /** Brings the note ritual into view. */
    onFocusNote: () => void;
}) {
    const { enter } = useUiMotion();
    const cadence = digestCadence ?? "Weekly · Fri 08:00 EAT";

    return (
        <Animated.View entering={enter(1)}>
            <Card variant="trust" style={styles.card}>
                <View style={styles.titleRow}>
                    <SunMark size={16} />
                    <Text style={styles.eyebrow}>Day zero</Text>
                </View>
                <Text style={styles.voice}>
                    Pledge received — {formatKes(amountKes)} of intent, not escrow. I'm now
                    following {ventureName}.
                </Text>
                <Text style={styles.voiceSub}>
                    Nothing is public yet. The loop starts with your first note: approve one
                    below and I'll log the KPI, write your digest, and seal it to the public
                    ledger. No note? The scheduled digest still lands — {cadence}
                    {nextDigestAt ? ` · next ${formatDueLabel(nextDigestAt)}` : ""}.
                </Text>
                <Button label="Write the first note" onPress={onFocusNote} />
            </Card>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    card: { gap: 10 },
    titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    eyebrow: {
        ...type.eyebrow,
    },
    voice: {
        fontFamily: font.bodyBold,
        fontSize: 14,
        lineHeight: 20,
        fontWeight: "700",
        color: color.ink,
    },
    voiceSub: {
        fontFamily: font.body,
        fontSize: 13,
        lineHeight: 19,
        color: color.mist,
    },
});
