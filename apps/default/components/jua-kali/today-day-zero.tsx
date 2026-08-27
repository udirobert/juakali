import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { useQuery } from "convex/react";
import { useRouter } from "expo-router";

import { api } from "@/convex/_generated/api";
import { LivingSun } from "@/components/jua-kali/living-sun";
import { Card, PressableScale, SectionLabel } from "@/components/jua-kali/ui";
import { useUiMotion } from "@/components/jua-kali/hooks/use-ui-motion";
import { color, font, type } from "@/components/jua-kali/theme";

/**
 * Day zero — the Today screen for an investor with nothing in flight yet:
 * no decision, no activity, no completed runs. Instead of a sparse greeting
 * over an empty canvas, a centered, designed first experience: the dawn sun,
 * the three steps of the loop, what's live on the platform right now, and one
 * clear way in (Browse deals). Same ledger honesty — soft pledges, not escrow.
 */
export function TodayDayZero({
    greetingName,
    briefingText,
}: {
    greetingName: string | null;
    briefingText: string;
}) {
    const router = useRouter();
    const { enter } = useUiMotion();
    const listVentures = useQuery(api.invest.listVentures, {});
    const ventures = listVentures?.ventures.slice(0, 3) ?? [];

    return (
        <View style={styles.wrap}>
            <Animated.View entering={enter(0)} style={styles.hero}>
                <LivingSun size={88} agentState="observing" />
                <Text style={styles.greeting}>
                    {greetingName ? `Good day, ${greetingName}` : "Good day"}
                </Text>
                <Text style={styles.briefing}>{briefingText}</Text>
            </Animated.View>

            <Animated.View entering={enter(1)} style={styles.column}>
                <Card accessibilityRole="summary">
                    <Text style={styles.eyebrow}>How it works</Text>
                    <View style={styles.steps}>
                        {STEPS.map((step, i) => (
                            <View key={step.title} style={styles.step}>
                                <View style={styles.stepN}>
                                    <Text style={styles.stepNText}>{i + 1}</Text>
                                </View>
                                <View style={styles.stepCopy}>
                                    <Text style={styles.stepTitle}>{step.title}</Text>
                                    <Text style={styles.stepBody}>{step.body}</Text>
                                </View>
                            </View>
                        ))}
                    </View>
                </Card>
            </Animated.View>

            {ventures.length > 0 ? (
                <Animated.View entering={enter(2)} style={styles.column}>
                    <SectionLabel>On the platform right now</SectionLabel>
                    <Card>
                        {ventures.map((venture, i) => (
                            <View key={venture.id} style={[styles.venture, i > 0 && styles.ventureNotFirst]}>
                                <Pressable
                                    onPress={() => router.push(`/(tabs)/deals?v=${venture.publicSlug}`)}
                                    style={styles.venturePress}
                                    accessibilityRole="button"
                                    accessibilityLabel={`${venture.name} — open in Deals`}
                                >
                                    <Text style={styles.ventureName}>{venture.name}</Text>
                                    <Text style={styles.ventureMeta}>
                                        {venture.craftText} · {venture.locationText}
                                    </Text>
                                </Pressable>
                                <Text style={styles.venturePledged}>
                                    KES {venture.pledgedKes.toLocaleString()} pledged
                                </Text>
                            </View>
                        ))}
                    </Card>
                </Animated.View>
            ) : null}

            <Animated.View entering={enter(ventures.length > 0 ? 3 : 2)} style={styles.ctaBlock}>
                <PressableScale
                    onPress={() => router.push("/(tabs)/deals")}
                    style={styles.cta}
                    accessibilityLabel="Browse deals"
                    accessibilityHint="Opens the Deals tab with ventures to back"
                >
                    <Text style={styles.ctaText}>Browse deals →</Text>
                </PressableScale>
                <Text style={styles.footnote}>Soft pledges — intent, not escrow or live payments.</Text>
            </Animated.View>
        </View>
    );
}

const STEPS = [
    {
        title: "Pick a venture",
        body: "Browse real Jua Kali ventures — the craft, the place, and the target they're working toward.",
    },
    {
        title: "Make a soft commitment",
        body: "Pledge a revenue share. It's intent, not escrow — a demo of the instrument.",
    },
    {
        title: "Approve Jua's work",
        body: "Jua mentors and checks in weekly. You approve each step, and proof lands on the public ledger.",
    },
];

const styles = StyleSheet.create({
    // One centered column — reads as a composed page on desktop, not a list
    // pinned to the top-left of a wide canvas.
    wrap: { alignItems: "center", gap: 28, paddingVertical: 28 },
    column: { width: "100%", maxWidth: 560, gap: 8 },
    hero: { alignItems: "center", gap: 14, maxWidth: 560 },
    greeting: { ...type.title, fontSize: 30, lineHeight: 36, textAlign: "center" },
    briefing: {
        ...type.body,
        fontSize: 16,
        lineHeight: 24,
        color: color.mist,
        textAlign: "center",
        maxWidth: 460,
    },
    eyebrow: { ...type.eyebrow },
    steps: { gap: 14 },
    step: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
    stepN: {
        width: 24,
        height: 24,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: color.brassBorder,
        backgroundColor: color.brassSoft,
        alignItems: "center",
        justifyContent: "center",
    },
    stepNText: { fontFamily: font.bodyBold, fontSize: 12, fontWeight: "700", color: color.brassDeep },
    stepCopy: { flex: 1, gap: 2 },
    stepTitle: { fontFamily: font.bodyBold, fontSize: 14, fontWeight: "700", color: color.ink },
    stepBody: { ...type.body, fontSize: 13, lineHeight: 19, color: color.mist },
    venture: { flexDirection: "row", alignItems: "center", gap: 12 },
    ventureNotFirst: {
        borderTopWidth: 1,
        borderTopColor: color.line,
        marginTop: 10,
        paddingTop: 10,
    },
    venturePress: { flex: 1, gap: 2 },
    ventureName: { fontFamily: font.bodyBold, fontSize: 14, fontWeight: "700", color: color.charcoal },
    ventureMeta: { ...type.body, fontSize: 12, lineHeight: 17, color: color.mist },
    venturePledged: {
        fontFamily: font.bodyBold,
        fontSize: 11,
        fontWeight: "700",
        color: color.brassDeep,
        fontVariant: ["tabular-nums"],
    },
    ctaBlock: { alignItems: "center", gap: 10 },
    cta: {
        backgroundColor: color.charcoal,
        borderRadius: 6,
        paddingVertical: 12,
        paddingHorizontal: 28,
        alignItems: "center",
    },
    ctaText: { fontFamily: font.bodyBold, fontSize: 14, fontWeight: "700", color: color.foam },
    footnote: { ...type.body, fontSize: 11, lineHeight: 16, color: color.mist, textAlign: "center" },
});
