import { useEffect, useMemo, useRef, useState } from "react";
import {
    Platform,
    Pressable,
    ScrollView,
    Share,
    Text,
    useWindowDimensions,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
    FadeIn,
    FadeOut,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from "react-native-reanimated";
import { useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import { SITE_URL } from "@/lib/site";
import { styles } from "@/components/jua-kali/ledger/public-ledger.styles";
import { TermHint } from "@/components/jua-kali/help";
import { SunMark } from "@/components/jua-kali/sun-mark";
import { LedgerSkeleton } from "@/components/jua-kali/loaders/ledger-skeleton";
import {
    IconBolt,
    IconCapital,
    IconChevronDown,
    IconPen,
    IconShare,
    IconSparkle,
    IconTrend,
} from "@/components/jua-kali/icons";
import { Chip, PressableScale } from "@/components/jua-kali/ui";
import { useCountUp } from "@/components/jua-kali/hooks/use-count-up";
import { useUiMotion } from "@/components/jua-kali/hooks/use-ui-motion";
import { successHaptic } from "@/components/jua-kali/haptics";
import { color, layout, motion } from "@/components/jua-kali/theme";

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
    correlationId?: string | null;
    runId?: string | null;
    initiator?: string | null;
    publicVisible?: boolean;
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
        case "wisdom":
            return "Wisdom";
        default:
            return "Action";
    }
}

/** Ledger glyph per event type — the type's drawn signature. */
function typeGlyph(type: string, size = 12) {
    switch (type) {
        case "pledge":
            return <IconCapital size={size} color={color.brassDeep} />;
        case "checkin":
            return <IconTrend size={size} color={color.brassDeep} />;
        case "digest":
            return <IconPen size={size} color={color.brassDeep} />;
        case "wisdom":
            return <IconSparkle size={size} color={color.brassDeep} />;
        default:
            return <IconBolt size={size} color={color.brassDeep} />;
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
    initialVentureSlug,
    onOpenEvent,
}: {
    onOpenGlossary?: (focusId?: string) => void;
    hideTitleChrome?: boolean;
    initialVentureSlug?: string;
    onOpenEvent?: (eventId: string) => void;
} = {}) {
    const [slug, setSlug] = useState<string | null>(() => initialVentureSlug ?? readLedgerSlug());
    /** The row opened into its full preview — one at a time, in place. */
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const data = useQuery(api.invest.publicLedger, {
        limit: 40,
        ventureSlug: slug ?? undefined,
    });
    const insets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    const compact = width < 440;
    const padX = Math.max(14, Math.min(28, (width - layout.maxWidth) / 2 + 16));
    const { reduceMotion } = useUiMotion();
    // Headline figures arrive rather than jump; 0 while the query is in flight.
    const pledged = useCountUp(data?.totals.pledgedKes ?? 0);

    // Stagger the feed only on the first boot. Filtering/swapping the venture
    // re-renders rows, but they shouldn't re-enter every time — the group is
    // present the moment the page boots, so we gate on "first content present".
    const booted = useRef(false);
    const firstPresent = data !== undefined && !booted.current;
    useEffect(() => {
        if (data !== undefined) booted.current = true;
    }, [data !== undefined]);

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
            const result = await Share.share({ message: `${title}\n${url}`, url, title });
            // The promise resolves on dismissal too — only celebrate a share that
            // actually left the app. (Android always resolves "sharedAction".)
            if (result.action !== Share.dismissedAction) {
                successHaptic();
            }
        } catch {
            // user dismissed — nothing to do
        }
    }

    if (data === undefined) {
        return <LedgerSkeleton />;
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
                    {/* High noon on the ledger — this is where proof lives. */}
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
                    <Text style={styles.total}>{formatKes(Math.round(pledged))}</Text>
                    <Text style={styles.totalHint}>
                        {selectedVenture ? `${selectedVenture.name} · soft pledges (demo — not escrow)` : "Soft pledges recorded (demo — not escrow)"}
                    </Text>
                    <View style={styles.stats}>
                        <Text style={styles.stat}>{data.totals.activeVentures} ventures</Text>
                        <Text style={styles.statDot}>·</Text>
                        <Pressable
                            onPress={onOpenGlossary ? () => onOpenGlossary("kpi") : undefined}
                            disabled={!onOpenGlossary}
                            hitSlop={4}
                            accessibilityRole="button"
                            accessibilityLabel="What is a KPI?"
                        >
                            <Text style={styles.stat}>{data.totals.checkIns} KPIs</Text>
                        </Pressable>
                        <Text style={styles.statDot}>·</Text>
                        <Pressable
                            onPress={onOpenGlossary ? () => onOpenGlossary("digest") : undefined}
                            disabled={!onOpenGlossary}
                            hitSlop={4}
                            accessibilityRole="button"
                            accessibilityLabel="What is a digest?"
                        >
                            <Text style={styles.stat}>{data.totals.digests} digests</Text>
                        </Pressable>
                        <Text style={styles.statDot}>·</Text>
                        <PressableScale
                            onPress={() => void handleShare()}
                            hitSlop={6}
                            style={styles.sharePill}
                            accessibilityLabel="Share this proof ledger"
                            accessibilityHint="Opens the native share sheet with a link to this ledger"
                        >
                            <View style={styles.shareRowInner}>
                                <IconShare size={13} color={color.brassDeep} />
                                <Text style={styles.shareLink}>Share proof</Text>
                            </View>
                        </PressableScale>
                    </View>
                </View>

                {data.ventures.length > 1 ? (
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.filterRow}
                    >
                        <Chip
                            label="All"
                            active={slug === null}
                            onPress={() => toggleFilter(null)}
                        />
                        {data.ventures.map((venture: LedgerVenture) => (
                            <Chip
                                key={venture.slug}
                                label={venture.name}
                                active={slug === venture.slug}
                                onPress={() => toggleFilter(slug === venture.slug ? null : venture.slug)}
                            />
                        ))}
                    </ScrollView>
                ) : null}

                <View style={styles.feed}>
                    {data.events.length === 0 ? (
                        <Text style={styles.empty}>
                            {selectedVenture
                                ? "No events yet for this venture — act on it from Deals and proof appears here."
                                : "No events yet — open Today, approve Jua's work, and proof appears here."}
                        </Text>
                    ) : (
                        data.events.map((event: LedgerEventRow, idx: number) => (
                            <Animated.View
                                key={event.id}
                                entering={
                                    firstPresent && !reduceMotion
                                        ? FadeIn.duration(motion.base).delay(Math.min(idx, 7) * motion.stagger)
                                        : undefined
                                }
                            >
                                <LedgerRow
                                    event={event}
                                    compact={compact}
                                    expanded={expandedId === event.id}
                                    onToggle={() => {
                                        if (onOpenEvent) {
                                            onOpenEvent(event.id);
                                            return;
                                        }
                                        setExpandedId((prev) => (prev === event.id ? null : event.id));
                                    }}
                                    onFilterVenture={() =>
                                        toggleFilter(slug === event.ventureSlug ? null : event.ventureSlug)
                                    }
                                    onOpenGlossary={onOpenGlossary}
                                />
                            </Animated.View>
                        ))
                    )}
                </View>
            </ScrollView>
        </View>
    );
}

/**
 * A ledger row opens into its full preview without leaving the feed — the
 * grid-to-preview move, adapted for touch. Collapsed rows stay terse; the
 * expanded row reveals the full summary, the recorded figures, and evidence
 * at readable size. One row open at a time.
 */
function LedgerRow({
    event,
    compact,
    expanded,
    onToggle,
    onFilterVenture,
    onOpenGlossary,
}: {
    event: LedgerEventRow;
    compact: boolean;
    expanded: boolean;
    onToggle: () => void;
    onFilterVenture: () => void;
    onOpenGlossary?: (focusId?: string) => void;
}) {
    const spin = useSharedValue(expanded ? 1 : 0);
    useEffect(() => {
        spin.value = withTiming(expanded ? 1 : 0, { duration: motion.fast });
    }, [expanded, spin]);
    const chevronStyle = useAnimatedStyle(() => ({
        transform: [{ rotate: `${spin.value * 180}deg` }],
    }));

    return (
        // No per-row layout transitions: detail fades in and neighbors reflow
        // immediately. Rows are many — layout animation is the expensive one.
        <View style={[styles.row, compact && styles.rowCompact]}>
            <Pressable
                onPress={onToggle}
                accessibilityRole="button"
                accessibilityLabel={`${typeLabel(event.type)} — ${event.summary.slice(0, 60)}`}
                accessibilityState={{ expanded }}
                accessibilityHint={expanded ? "Collapse details" : "Expand full record"}
            >
                <View style={styles.rowTop}>
                    <View style={styles.typeRow}>
                        {typeGlyph(event.type)}
                        <Text style={styles.type}>{typeLabel(event.type)}</Text>
                        {onOpenGlossary ? (
                            <TermHint termId={typeHint(event.type)} onOpenGlossary={onOpenGlossary} />
                        ) : null}
                    </View>
                    <View style={styles.rowWhen}>
                        <Text style={styles.when}>{formatWhen(event.createdAt)}</Text>
                        <Animated.View style={chevronStyle}>
                            <IconChevronDown size={13} color={color.mist} />
                        </Animated.View>
                    </View>
                </View>
                <Text style={styles.summary} numberOfLines={expanded ? undefined : compact ? 2 : 3}>
                    {event.summary}
                </Text>
            </Pressable>
            <View style={styles.rowFoot}>
                {event.ventureName ? (
                    <Pressable
                        onPress={onFilterVenture}
                        disabled={!event.ventureSlug}
                        hitSlop={4}
                        accessibilityRole="button"
                        accessibilityLabel={`Filter ledger by ${event.ventureName}`}
                    >
                        <Text style={styles.venture}>{event.ventureName}</Text>
                    </Pressable>
                ) : (
                    <View />
                )}
                {event.evidence.length > 0 && !expanded ? (
                    <View style={styles.evidenceRow}>
                        {(compact && event.evidence.length > 1
                            ? [event.evidence[0]!, `+${event.evidence.length - 1}`]
                            : event.evidence
                        ).map((tag: string) => (
                            <View key={tag} style={[styles.evidenceChip, compact && styles.evidenceChipNarrow]}>
                                <Text style={styles.evidenceChipText}>{tag}</Text>
                            </View>
                        ))}
                    </View>
                ) : null}
            </View>

            {expanded ? (
                <Animated.View
                    entering={FadeIn.duration(motion.base)}
                    exiting={FadeOut.duration(motion.fast)}
                    style={styles.rowDetail}
                >
                    {event.amountKes != null ? (
                        <View style={styles.detailLine}>
                            <Text style={styles.detailLabel}>Recorded</Text>
                            <Text style={styles.detailValue}>{formatKes(event.amountKes)}</Text>
                        </View>
                    ) : null}
                    {event.metric && event.value != null ? (
                        <View style={styles.detailLine}>
                            <Text style={styles.detailLabel}>Metric</Text>
                            <Text style={[styles.detailValue, styles.detailValueNum]}>
                                {event.metric} · {event.value}
                            </Text>
                        </View>
                    ) : null}
                    {event.evidence.length > 0 ? (
                        <View style={styles.detailLine}>
                            <Text style={styles.detailLabel}>Evidence</Text>
                            <View style={styles.evidenceRow}>
                                {event.evidence.map((tag: string) => (
                                    <View key={tag} style={[styles.evidenceChip, styles.evidenceChipBig]}>
                                        <Text style={[styles.evidenceChipText, styles.evidenceChipTextBig]}>
                                            {tag}
                                        </Text>
                                    </View>
                                ))}
                            </View>
                        </View>
                    ) : null}
                </Animated.View>
            ) : null}
        </View>
    );
}

