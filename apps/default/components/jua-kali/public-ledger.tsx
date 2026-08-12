import { useState } from "react";
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";

const palette = {
    sage: "#9CAF88",
    terracotta: "#E07A5F",
    cream: "#F5F1E8",
    olive: "#3B4D3B",
    ink: "#243124",
    moss: "#71845F",
    sand: "#E7D8C5",
};

function formatKes(value: number) {
    return `KES ${value.toLocaleString()}`;
}

function formatWhen(ts: number) {
    return new Date(ts).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function typeLabel(type: string) {
    switch (type) {
        case "pledge":
            return "Capital";
        case "checkin":
            return "Result";
        case "digest":
            return "Digest";
        default:
            return "Action";
    }
}

export function PublicLedger() {
    const data = useQuery(api.invest.publicLedger, { limit: 40 });
    const seedInvestDemo = useMutation(api.invest.seedInvestDemo);
    const insets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    const isWide = width >= 900;
    const isCompact = width < 420;
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [isSeeding, setIsSeeding] = useState(false);

    async function handleSeed() {
        setIsSeeding(true);
        try {
            const result = await seedInvestDemo({});
            setStatusMessage(
                `${result.message}: ${result.createdVentures} ventures, ${result.createdCommitments} pledges, ${result.createdCheckIns} KPIs.`
            );
        } catch (error) {
            setStatusMessage(error instanceof Error ? error.message : "Could not seed invest demo.");
        } finally {
            setIsSeeding(false);
        }
    }

    if (data === undefined) {
        return (
            <View style={styles.loadingScreen}>
                <ActivityIndicator color={palette.olive} />
                <Text style={styles.loadingText}>Loading public ledger…</Text>
            </View>
        );
    }

    return (
        <View style={styles.screen}>
            <ScrollView
                contentContainerStyle={[
                    styles.content,
                    {
                        paddingTop: Math.max(insets.top, 12) + 6,
                        paddingHorizontal: isCompact ? 14 : 20,
                    },
                ]}
                contentInsetAdjustmentBehavior="automatic"
            >
                <View style={[styles.hero, isWide && styles.heroWide]}>
                    <View style={styles.heroCopy}>
                        <Text style={styles.eyebrow}>Invest in public</Text>
                        <Text accessibilityRole="header" style={[styles.title, isWide && styles.titleWide]}>
                            Public evidence
                        </Text>
                        <Text style={styles.subtitle}>
                            Soft pledges and hard results. Demo commitments only — not regulated securities.
                        </Text>
                        <Pressable
                            onPress={handleSeed}
                            disabled={isSeeding}
                            style={[styles.button, isSeeding && styles.buttonDisabled]}
                        >
                            <Text style={styles.buttonText}>{isSeeding ? "Seeding…" : "Seed invest demo"}</Text>
                        </Pressable>
                        {statusMessage ? <Text style={styles.statusLine}>{statusMessage}</Text> : null}
                    </View>
                    <LinearGradient
                        colors={["rgba(59,77,59,0.95)", "rgba(156,175,136,0.85)", "rgba(224,122,95,0.8)"]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.heroFigure}
                    >
                        <Text style={styles.figureNumber}>{formatKes(data.totals.pledgedKes)}</Text>
                        <Text style={styles.figureLabel}>Pledged across active ventures</Text>
                    </LinearGradient>
                </View>

                <View style={[styles.metricsRow, isWide && styles.metricsRowWide]}>
                    <Metric label="Active ventures" value={String(data.totals.activeVentures)} />
                    <Metric label="KPI check-ins" value={String(data.totals.checkIns)} />
                    <Metric label="Investor digests" value={String(data.totals.digests)} />
                    <Metric label="Pledged" value={formatKes(data.totals.pledgedKes)} />
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Public ledger</Text>
                    <Text style={styles.sectionSubtitle}>
                        Append-only feed of pledges, agent actions, KPI evidence, and digests.
                    </Text>
                    {data.events.length === 0 ? (
                        <View style={styles.empty}>
                            <Text style={styles.emptyTitle}>No public events yet</Text>
                            <Text style={styles.emptyBody}>Seed the invest demo to populate the ledger for lead walkthroughs.</Text>
                        </View>
                    ) : (
                        data.events.map((event) => (
                            <View key={event.id} style={styles.eventRow}>
                                <View style={styles.eventMeta}>
                                    <Text style={styles.eventType}>{typeLabel(event.type)}</Text>
                                    <Text style={styles.eventWhen}>{formatWhen(event.createdAt)}</Text>
                                </View>
                                <Text style={styles.eventSummary}>{event.summary}</Text>
                                {event.ventureName ? (
                                    <Text style={styles.eventVenture}>{event.ventureName}</Text>
                                ) : null}
                            </View>
                        ))
                    )}
                </View>
            </ScrollView>
        </View>
    );
}

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <View style={styles.metric}>
            <Text style={styles.metricValue}>{value}</Text>
            <Text style={styles.metricLabel}>{label}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: palette.cream },
    loadingScreen: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        backgroundColor: palette.cream,
    },
    loadingText: { color: palette.ink, opacity: 0.7 },
    content: { paddingBottom: 48, gap: 22 },
    hero: { gap: 18 },
    heroWide: { flexDirection: "row", alignItems: "stretch" },
    heroCopy: { flex: 1.2, gap: 12 },
    eyebrow: {
        color: palette.terracotta,
        fontSize: 12,
        fontWeight: "700",
        letterSpacing: 1.4,
        textTransform: "uppercase",
    },
    title: {
        color: palette.olive,
        fontSize: 34,
        fontWeight: "800",
        letterSpacing: -1,
        lineHeight: 38,
    },
    titleWide: { fontSize: 42, lineHeight: 46 },
    subtitle: {
        color: "rgba(36,49,36,0.75)",
        fontSize: 15,
        lineHeight: 22,
        fontWeight: "300",
        maxWidth: 520,
    },
    button: {
        alignSelf: "flex-start",
        backgroundColor: palette.terracotta,
        paddingHorizontal: 18,
        paddingVertical: 12,
        borderRadius: 18,
    },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { color: palette.cream, fontWeight: "700" },
    statusLine: { color: palette.moss, fontSize: 13 },
    heroFigure: {
        flex: 0.8,
        minHeight: 160,
        borderTopLeftRadius: 48,
        borderTopRightRadius: 16,
        borderBottomLeftRadius: 18,
        borderBottomRightRadius: 42,
        padding: 22,
        justifyContent: "flex-end",
        gap: 6,
    },
    figureNumber: { color: palette.cream, fontSize: 28, fontWeight: "900" },
    figureLabel: { color: "rgba(245,241,232,0.85)", fontSize: 13, fontWeight: "300" },
    metricsRow: { gap: 12 },
    metricsRowWide: { flexDirection: "row" },
    metric: {
        flex: 1,
        backgroundColor: "rgba(255,253,247,0.8)",
        borderWidth: 1,
        borderColor: "rgba(59,77,59,0.12)",
        borderRadius: 22,
        padding: 16,
        gap: 4,
    },
    metricValue: { color: palette.olive, fontSize: 22, fontWeight: "800" },
    metricLabel: {
        color: palette.ink,
        fontSize: 11,
        fontWeight: "600",
        letterSpacing: 0.8,
        textTransform: "uppercase",
        opacity: 0.7,
    },
    section: {
        gap: 12,
        padding: 18,
        backgroundColor: "rgba(255,253,247,0.72)",
        borderTopLeftRadius: 36,
        borderTopRightRadius: 14,
        borderBottomLeftRadius: 16,
        borderBottomRightRadius: 40,
        borderWidth: 1,
        borderColor: "rgba(59,77,59,0.12)",
    },
    sectionTitle: { color: palette.olive, fontSize: 24, fontWeight: "800" },
    sectionSubtitle: { color: "rgba(36,49,36,0.7)", fontSize: 14, lineHeight: 20, marginBottom: 4 },
    empty: { gap: 6, paddingVertical: 18 },
    emptyTitle: { color: palette.olive, fontWeight: "700", fontSize: 16 },
    emptyBody: { color: "rgba(36,49,36,0.65)", fontSize: 14, lineHeight: 20 },
    eventRow: {
        gap: 6,
        paddingVertical: 14,
        borderTopWidth: 1,
        borderTopColor: "rgba(59,77,59,0.08)",
    },
    eventMeta: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    eventType: {
        color: palette.terracotta,
        fontSize: 11,
        fontWeight: "800",
        letterSpacing: 1,
        textTransform: "uppercase",
    },
    eventWhen: { color: "rgba(36,49,36,0.5)", fontSize: 12 },
    eventSummary: { color: palette.ink, fontSize: 15, lineHeight: 21, fontWeight: "500" },
    eventVenture: { color: palette.moss, fontSize: 13, fontWeight: "600" },
});
