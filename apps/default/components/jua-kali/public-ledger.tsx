import { useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Platform,
    Pressable,
    ScrollView,
    Share,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import { SITE_URL } from "@/lib/site";
import { TermHint } from "@/components/jua-kali/help";
import { SunMark } from "@/components/jua-kali/sun-mark";
import { color, font, layout } from "@/components/jua-kali/theme";

function formatKes(value: number) {
    return `KES ${value.toLocaleString()}`;
}

// Local mirrors of the publicLedger query shapes (typed codegen returns after
// `npx convex dev` regenerates _generated/api; explicit annotations keep this
// file strict-mode clean in the meantime).
type LedgerEventRow = {
    id: string;
    type: string;
    summary: string;
    amountKes: number | null;
    metric: string | null;
    value: number | null;
    evidence: string[];
    ventureName: string | null;
    ventureSlug: string | null;
    createdAt: number;
};

type LedgerVenture = {
    id: string;
    name: string;
    slug: string;
};

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

/** Ledger glyph per event type — a light signature for rows. */
function typeGlyph(type: string) {
    switch (type) {
        case "pledge":
            return "◈";
        case "checkin":
            return "▲";
        case "digest":
            return "✎";
        default:
            return "⚡";
    }
}

function typeHint(type: string) {
    switch (type) {
        case "pledge":
            return "soft-pledge";
        case "checkin":
            return "kpi";
        case "digest":
            return "digest";
        default:
            return "ledger";
    }
}

/** Deep-link filter: /?ledger=<venture-slug> opens the ledger scoped to that deal. */
function readLedgerSlug(): string | null {
    if (Platform.OS !== "web" || typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("ledger");
}

function writeLedgerSlug(slug: string | null) {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (slug) url.searchParams.set("ledger", slug);
    else url.searchParams.delete("ledger");
    window.history.replaceState({}, "", url.toString());
}

export function PublicLedger({
    onOpenGlossary,
    hideTitleChrome = false,
}: {
    onOpenGlossary?: (focusId?: string) => void;
    hideTitleChrome?: boolean;
} = {}) {
    const [slug, setSlug] = useState<string | null>(() => readLedgerSlug());
    const data = useQuery(api.invest.publicLedger, {
        limit: 40,
        ventureSlug: slug ?? undefined,
    });
    const insets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    const compact = width < 440;
    const padX = Math.max(14, Math.min(28, (width - layout.maxWidth) / 2 + 16));

    // Keep the URL shareable as the filter changes.
    useEffect(() => {
        writeLedgerSlug(slug);
    }, [slug]);

    const selectedVenture = useMemo(
        () => data?.ventures.find((venture: LedgerVenture) => venture.slug === slug) ?? null,
        [data, slug]
    );

    function toggleFilter(next: string | null) {
        setSlug(next);
    }

    async function handleShare() {
        const url = slug ? `${SITE_URL}/deal/${slug}` : SITE_URL;
        const title = selectedVenture
            ? `${selectedVenture.name} — public ledger`
            : "JuaKali — public ledger";
        try {
            await Share.share({ message: `${title}\n${url}`, url, title });
        } catch {
            // user dismissed — nothing to do
        }
    }

    if (data === undefined) {
        return (
            <View style={styles.loadingScreen}>
                <ActivityIndicator color={color.brass} />
            </View>
        );
    }

    return (
        <View style={[styles.screen, { paddingTop: hideTitleChrome ? 8 : insets.top }]}>
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
                    <SunMark size={28} />
                    {!hideTitleChrome ? (
                        <View style={styles.titleRow}>
                            <Text style={styles.title}>Public ledger</Text>
                        </View>
                    ) : (
                        <View style={styles.titleRow}>
                            <Text style={styles.titleCompact}>Public proof</Text>
                        </View>
                    )}
                    <Text style={styles.sub}>
                        {compact
                            ? "Read-only timeline of pledges, KPIs, and digests from My deals."
                            : "Read-only public proof — capital pledges, KPI check-ins, and digests. Act on My deals; proof lands here."}
                    </Text>
                    <Text style={styles.total}>{formatKes(data.totals.pledgedKes)}</Text>
                    <Text style={styles.totalHint}>
                        {selectedVenture ? `${selectedVenture.name} · soft pledges (demo — not escrow)` : "Soft pledges recorded (demo — not escrow)"}
                    </Text>
                    <View style={styles.stats}>
                        <Text style={styles.stat}>{data.totals.activeVentures} ventures</Text>
                        <Text style={styles.statDot}>·</Text>
                        <Pressable
                            onPress={onOpenGlossary ? () => onOpenGlossary("kpi") : undefined}
                            disabled={!onOpenGlossary}
                        >
                            <Text style={styles.stat}>{data.totals.checkIns} KPIs</Text>
                        </Pressable>
                        <Text style={styles.statDot}>·</Text>
                        <Pressable
                            onPress={onOpenGlossary ? () => onOpenGlossary("digest") : undefined}
                            disabled={!onOpenGlossary}
                        >
                            <Text style={styles.stat}>{data.totals.digests} digests</Text>
                        </Pressable>
                        <Text style={styles.statDot}>·</Text>
                        <Pressable onPress={() => void handleShare()} hitSlop={6} accessibilityRole="button">
                            <Text style={styles.shareLink}>Share</Text>
                        </Pressable>
                    </View>
                </View>

                {data.ventures.length > 1 ? (
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.filterRow}
                    >
                        <Pressable
                            onPress={() => toggleFilter(null)}
                            style={[styles.filterChip, slug === null && styles.filterChipOn]}
                        >
                            <Text style={[styles.filterChipText, slug === null && styles.filterChipTextOn]}>
                                All
                            </Text>
                        </Pressable>
                        {data.ventures.map((venture: LedgerVenture) => {
                            const on = slug === venture.slug;
                            return (
                                <Pressable
                                    key={venture.slug}
                                    onPress={() => toggleFilter(on ? null : venture.slug)}
                                    style={[styles.filterChip, on && styles.filterChipOn]}
                                >
                                    <Text style={[styles.filterChipText, on && styles.filterChipTextOn]}>
                                        {venture.name}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </ScrollView>
                ) : null}

                <View style={styles.feed}>
                    {data.events.length === 0 ? (
                        <Text style={styles.empty}>
                            {selectedVenture
                                ? "No events yet for this venture — act on it from My deals and proof appears here."
                                : "No events yet — open My deals, send a note to the agent, and approve it. Proof appears here."}
                        </Text>
                    ) : (
                        data.events.map((event: LedgerEventRow) => (
                            <View key={event.id} style={styles.row}>
                                <View style={styles.rowTop}>
                                    <View style={styles.typeRow}>
                                        <Text style={styles.typeGlyph}>{typeGlyph(event.type)}</Text>
                                        <Text style={styles.type}>{typeLabel(event.type)}</Text>
                                        {onOpenGlossary ? (
                                            <TermHint
                                                termId={typeHint(event.type)}
                                                onOpenGlossary={onOpenGlossary}
                                            />
                                        ) : null}
                                    </View>
                                    <Text style={styles.when}>{formatWhen(event.createdAt)}</Text>
                                </View>
                                <Text style={styles.summary} numberOfLines={compact ? 2 : 3}>
                                    {event.summary}
                                </Text>
                                <View style={styles.rowFoot}>
                                    {event.ventureName ? (
                                        <Pressable
                                            onPress={() =>
                                                toggleFilter(slug === event.ventureSlug ? null : event.ventureSlug)
                                            }
                                            disabled={!event.ventureSlug}
                                            hitSlop={4}
                                        >
                                            <Text style={styles.venture}>{event.ventureName}</Text>
                                        </Pressable>
                                    ) : (
                                        <View />
                                    )}
                                    {event.evidence.length > 0 ? (
                                        <View style={styles.evidenceRow}>
                                            {event.evidence.map((tag: string) => (
                                                <View key={tag} style={styles.evidenceChip}>
                                                    <Text style={styles.evidenceChipText}>{tag}</Text>
                                                </View>
                                            ))}
                                        </View>
                                    ) : null}
                                </View>
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
    titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    title: {
        fontFamily: font.display,
        fontSize: 34,
        fontWeight: "700",
        letterSpacing: -1,
        color: color.charcoal,
    },
    titleCompact: {
        fontFamily: font.displayMedium,
        fontSize: 22,
        fontWeight: "600",
        letterSpacing: -0.4,
        color: color.charcoal,
    },
    sub: {
        fontFamily: font.body,
        fontSize: 13,
        color: color.mist,
        textAlign: "center",
        maxWidth: 380,
        lineHeight: 18,
    },
    total: {
        fontFamily: font.display,
        fontSize: 40,
        fontWeight: "700",
        letterSpacing: -1.2,
        color: color.charcoal,
        marginTop: 4,
    },
    totalHint: {
        fontFamily: font.body,
        fontSize: 11,
        color: color.mist,
        marginTop: -4,
        textAlign: "center",
    },
    stats: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "center" },
    stat: { fontFamily: font.bodyBold, fontSize: 12, fontWeight: "700", color: color.ink },
    statDot: { color: color.mist },
    shareLink: { fontFamily: font.bodyBold, fontSize: 12, fontWeight: "700", color: color.brassDeep },
    filterRow: { gap: 6, paddingHorizontal: 2, paddingVertical: 2 },
    filterChip: {
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 4,
        backgroundColor: color.paper,
        borderWidth: 1,
        borderColor: color.line,
    },
    filterChipOn: { borderColor: color.brass, backgroundColor: color.brassSoft },
    filterChipText: { fontFamily: font.bodyBold, fontSize: 12, fontWeight: "700", color: color.ink },
    filterChipTextOn: { color: color.charcoal },
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
        lineHeight: 19,
    },
    row: {
        gap: 4,
        paddingVertical: 12,
        borderTopWidth: 1,
        borderTopColor: color.line,
    },
    rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    typeRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    typeGlyph: { fontSize: 10, color: color.brassDeep },
    type: {
        fontFamily: font.bodyBold,
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 0.8,
        textTransform: "uppercase",
        color: color.brassDeep,
    },
    when: { fontFamily: font.body, fontSize: 11, color: color.mist },
    summary: { fontFamily: font.body, fontSize: 14, lineHeight: 20, color: color.ink },
    rowFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
    venture: { fontFamily: font.bodyBold, fontSize: 12, fontWeight: "700", color: color.charcoal },
    evidenceRow: { flexDirection: "row", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" },
    evidenceChip: {
        paddingHorizontal: 7,
        paddingVertical: 3,
        borderRadius: 4,
        backgroundColor: color.brassSoft,
        borderWidth: 1,
        borderColor: "rgba(166,124,45,0.25)",
    },
    evidenceChipText: {
        fontFamily: font.bodyBold,
        fontSize: 9,
        fontWeight: "700",
        letterSpacing: 0.4,
        textTransform: "uppercase",
        color: color.brassDeep,
    },
});
