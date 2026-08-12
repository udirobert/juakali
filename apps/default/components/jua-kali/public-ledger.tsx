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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import { color, font, layout, type } from "@/components/jua-kali/theme";

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
    const isCompact = width < 420;
    const padX = Math.max(16, Math.min(32, (width - layout.maxWidth) / 2 + 20));
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
                <ActivityIndicator color={color.brass} />
                <Text style={styles.loadingText}>Loading public ledger…</Text>
            </View>
        );
    }

    return (
        <View style={[styles.screen, { paddingTop: insets.top }]}>
            <ScrollView
                contentContainerStyle={[
                    styles.content,
                    {
                        paddingHorizontal: padX,
                        paddingBottom: Math.max(insets.bottom, 24) + 88,
                        maxWidth: layout.maxWidth,
                        width: "100%",
                        alignSelf: "center",
                    },
                ]}
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.hero}>
                    <Text style={type.eyebrow}>Invest in public</Text>
                    <Text accessibilityRole="header" style={[styles.title, isCompact && styles.titleCompact]}>
                        Public ledger
                    </Text>
                    <Text style={styles.subtitle}>
                        Soft pledges and hard results — append-only evidence. Demo only, not regulated securities.
                    </Text>
                    <View style={styles.totals}>
                        <Text style={styles.totalValue}>{formatKes(data.totals.pledgedKes)}</Text>
                        <Text style={styles.totalLabel}>Pledged across active ventures</Text>
                    </View>
                    <Pressable
                        onPress={handleSeed}
                        disabled={isSeeding}
                        style={[styles.button, isSeeding && styles.buttonDisabled]}
                    >
                        <Text style={styles.buttonText}>{isSeeding ? "Seeding…" : "Seed invest demo"}</Text>
                    </Pressable>
                    {statusMessage ? <Text style={styles.statusLine}>{statusMessage}</Text> : null}
                </View>

                <View style={styles.metricsRow}>
                    <Metric label="Ventures" value={String(data.totals.activeVentures)} />
                    <Metric label="Check-ins" value={String(data.totals.checkIns)} />
                    <Metric label="Digests" value={String(data.totals.digests)} />
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Evidence feed</Text>
                    <Text style={styles.sectionSubtitle}>
                        Pledges, agent actions, KPI check-ins, and digests — newest first.
                    </Text>
                    {data.events.length === 0 ? (
                        <View style={styles.empty}>
                            <Text style={styles.emptyTitle}>No public events yet</Text>
                            <Text style={styles.emptyBody}>Seed the demo to populate the ledger.</Text>
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
    screen: { flex: 1, backgroundColor: color.stone },
    loadingScreen: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        backgroundColor: color.stone,
    },
    loadingText: { ...type.meta },
    content: { paddingTop: 12, gap: 20 },
    hero: { gap: 10, alignItems: "center" },
    title: { ...type.brand, fontSize: 36, textAlign: "center" },
    titleCompact: { fontSize: 30 },
    subtitle: { ...type.body, color: color.mist, textAlign: "center", maxWidth: 480 },
    totals: {
        alignItems: "center",
        gap: 4,
        paddingVertical: 16,
        paddingHorizontal: 24,
        backgroundColor: color.paper,
        borderWidth: 1,
        borderColor: color.line,
        borderRadius: 6,
        width: "100%",
        maxWidth: 420,
    },
    totalValue: {
        fontFamily: font.display,
        color: color.charcoal,
        fontSize: 28,
        fontWeight: "700",
        letterSpacing: -0.6,
    },
    totalLabel: { ...type.meta },
    button: {
        backgroundColor: color.charcoal,
        paddingHorizontal: 18,
        paddingVertical: 12,
        borderRadius: 4,
        marginTop: 4,
    },
    buttonDisabled: { opacity: 0.55 },
    buttonText: { fontFamily: font.bodyBold, color: color.paper, fontWeight: "700", fontSize: 13 },
    statusLine: { ...type.meta, color: color.brass, textAlign: "center" },
    metricsRow: { flexDirection: "row", gap: 10 },
    metric: {
        flex: 1,
        backgroundColor: color.paper,
        borderWidth: 1,
        borderColor: color.line,
        borderRadius: 4,
        padding: 14,
        gap: 4,
    },
    metricValue: {
        fontFamily: font.display,
        color: color.charcoal,
        fontSize: 22,
        fontWeight: "700",
    },
    metricLabel: {
        fontFamily: font.bodyBold,
        color: color.mist,
        fontSize: 10,
        fontWeight: "700",
        letterSpacing: 0.6,
        textTransform: "uppercase",
    },
    section: {
        gap: 10,
        padding: 18,
        backgroundColor: color.paper,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: color.line,
    },
    sectionTitle: { ...type.title, fontSize: 22 },
    sectionSubtitle: { ...type.meta, lineHeight: 18, marginBottom: 4 },
    empty: { gap: 6, paddingVertical: 18 },
    emptyTitle: { fontFamily: font.bodyBold, color: color.charcoal, fontWeight: "700", fontSize: 15 },
    emptyBody: { ...type.meta, lineHeight: 18 },
    eventRow: {
        gap: 6,
        paddingVertical: 14,
        borderTopWidth: 1,
        borderTopColor: color.line,
    },
    eventMeta: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    eventType: {
        fontFamily: font.bodyBold,
        color: color.brass,
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 1,
        textTransform: "uppercase",
    },
    eventWhen: { ...type.meta },
    eventSummary: {
        fontFamily: font.body,
        color: color.ink,
        fontSize: 15,
        lineHeight: 21,
        fontWeight: "500",
    },
    eventVenture: { fontFamily: font.bodyMedium, color: color.mist, fontSize: 13, fontWeight: "500" },
});
