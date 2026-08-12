import {
    ActivityIndicator,
    ScrollView,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import { color, font, layout } from "@/components/jua-kali/theme";

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
            return "KPI";
        case "digest":
            return "Digest";
        default:
            return "Action";
    }
}

export function PublicLedger() {
    const data = useQuery(api.invest.publicLedger, { limit: 40 });
    const insets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    const compact = width < 440;
    const padX = Math.max(14, Math.min(28, (width - layout.maxWidth) / 2 + 16));

    if (data === undefined) {
        return (
            <View style={styles.loadingScreen}>
                <ActivityIndicator color={color.brass} />
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
                        paddingBottom: Math.max(insets.bottom, 20) + 80,
                        maxWidth: layout.maxWidth,
                        width: "100%",
                        alignSelf: "center",
                    },
                ]}
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.hero}>
                    <Text style={styles.title}>Ledger</Text>
                    <Text style={styles.sub}>
                        {compact ? "Public proof of pledges & KPIs." : "Public proof — pledges, actions, KPIs, digests."}
                    </Text>
                    <Text style={styles.total}>{formatKes(data.totals.pledgedKes)}</Text>
                    <View style={styles.stats}>
                        <Text style={styles.stat}>{data.totals.activeVentures} ventures</Text>
                        <Text style={styles.statDot}>·</Text>
                        <Text style={styles.stat}>{data.totals.checkIns} KPIs</Text>
                        <Text style={styles.statDot}>·</Text>
                        <Text style={styles.stat}>{data.totals.digests} digests</Text>
                    </View>
                </View>

                <View style={styles.feed}>
                    {data.events.length === 0 ? (
                        <Text style={styles.empty}>No events yet — approve an agent action from Home.</Text>
                    ) : (
                        data.events.map((event) => (
                            <View key={event.id} style={styles.row}>
                                <View style={styles.rowTop}>
                                    <Text style={styles.type}>{typeLabel(event.type)}</Text>
                                    <Text style={styles.when}>{formatWhen(event.createdAt)}</Text>
                                </View>
                                <Text style={styles.summary} numberOfLines={compact ? 2 : 3}>
                                    {event.summary}
                                </Text>
                                {event.ventureName ? (
                                    <Text style={styles.venture}>{event.ventureName}</Text>
                                ) : null}
                            </View>
                        ))
                    )}
                </View>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.stone },
    loadingScreen: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: color.stone,
    },
    content: { paddingTop: 8, gap: 16 },
    hero: { alignItems: "center", gap: 8 },
    title: {
        fontFamily: font.display,
        fontSize: 34,
        fontWeight: "700",
        letterSpacing: -1,
        color: color.charcoal,
    },
    sub: {
        fontFamily: font.body,
        fontSize: 13,
        color: color.mist,
        textAlign: "center",
        maxWidth: 320,
    },
    total: {
        fontFamily: font.display,
        fontSize: 26,
        fontWeight: "700",
        color: color.charcoal,
        marginTop: 4,
    },
    stats: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "center" },
    stat: { fontFamily: font.bodyBold, fontSize: 12, fontWeight: "700", color: color.mist },
    statDot: { color: color.mist },
    feed: {
        backgroundColor: color.paper,
        borderWidth: 1,
        borderColor: color.line,
        borderRadius: 6,
        paddingHorizontal: 14,
    },
    empty: {
        fontFamily: font.body,
        fontSize: 13,
        color: color.mist,
        textAlign: "center",
        paddingVertical: 24,
    },
    row: {
        gap: 4,
        paddingVertical: 12,
        borderTopWidth: 1,
        borderTopColor: color.line,
    },
    rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    type: {
        fontFamily: font.bodyBold,
        fontSize: 10,
        fontWeight: "700",
        letterSpacing: 0.8,
        textTransform: "uppercase",
        color: color.brass,
    },
    when: { fontFamily: font.body, fontSize: 11, color: color.mist },
    summary: { fontFamily: font.body, fontSize: 14, lineHeight: 19, color: color.ink },
    venture: { fontFamily: font.bodyMedium, fontSize: 12, color: color.mist },
});
