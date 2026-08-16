import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useMutation } from "convex/react";

import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { Button, Card, Chip, Input } from "@/components/jua-kali/ui";
import { IconBolt, IconLink, IconPen, IconSparkle } from "@/components/jua-kali/icons";
import { useDictation } from "@/components/jua-kali/hooks/use-dictation";
import { tapHaptic } from "@/components/jua-kali/haptics";
import { color, font } from "@/components/jua-kali/theme";

type WisdomItem = FunctionReturnType<typeof api.wisdom.wisdomForVenture>[number];
type Kind = "article" | "podcast" | "note" | "voice";

const KINDS: Array<{ id: Kind; label: string }> = [
    { id: "article", label: "Article" },
    { id: "podcast", label: "Podcast" },
    { id: "note", label: "Experience" },
    { id: "voice", label: "Voice" },
];

function kindGlyph(kind: Kind, size = 13) {
    switch (kind) {
        case "article":
            return <IconLink size={size} color={color.brassDeep} />;
        case "podcast":
            return <IconBolt size={size} color={color.brassDeep} />;
        case "voice":
            return <IconSparkle size={size} color={color.brassDeep} />;
        default:
            return <IconPen size={size} color={color.brassDeep} />;
    }
}

function hostOf(url: string | null): string | null {
    if (!url) return null;
    try {
        return new URL(url).host.replace(/^www\./, "");
    } catch {
        return null;
    }
}

/**
 * The mentor's share bar — a link, a few words, or a spoken note, aimed at
 * one venture. Jua starts reading the moment it's shared.
 */
export function ShareWisdomCard({
    ventureName,
    ventureId,
}: {
    ventureName: string;
    ventureId: string;
}) {
    const [open, setOpen] = useState(false);
    const [kind, setKind] = useState<Kind>("article");
    const [url, setUrl] = useState("");
    const [text, setText] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const shareWisdom = useMutation(api.wisdom.shareWisdom);
    const dictation = useDictation((transcript) =>
        setText((prev) => (prev ? `${prev} ${transcript}` : transcript)),
    );

    async function handleShare() {
        setError(null);
        if (!url.trim() && !text.trim()) {
            setError("Share a link or a few words.");
            return;
        }
        setBusy(true);
        try {
            await shareWisdom({
                ventureId: ventureId as never,
                kind,
                sourceUrl: url.trim() || undefined,
                body: text.trim() || undefined,
            });
            setUrl("");
            setText("");
            setOpen(false);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not share.");
        } finally {
            setBusy(false);
        }
    }

    if (!open) {
        return (
            <Button
                label="Share wisdom"
                variant="ghost"
                onPress={() => setOpen(true)}
                icon={kindGlyph("note", 14)}
                style={styles.shareToggle}
            />
        );
    }

    return (
        <Card>
            <View style={styles.cardTop}>
                <View style={styles.titleRow}>
                    <IconSparkle size={15} color={color.brassDeep} />
                    <Text style={styles.cardTitle}>Share with {ventureName}</Text>
                </View>
                <Pressable onPress={() => setOpen(false)} hitSlop={8} accessibilityRole="button">
                    <Text style={styles.close}>Close</Text>
                </Pressable>
            </View>
            <Text style={styles.hint}>
                A link, a few lines, or spoken words — Jua reads it and proposes how to apply it.
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.kindRow}>
                {KINDS.map((k) => (
                    <Chip key={k.id} label={k.label} active={kind === k.id} onPress={() => setKind(k.id)} />
                ))}
            </ScrollView>
            {(kind === "article" || kind === "podcast") && (
                <Input
                    value={url}
                    onChangeText={setUrl}
                    placeholder="Paste a link (article or episode)"
                    autoCapitalize="none"
                    keyboardType="url"
                />
            )}
            <View style={styles.composerRow}>
                <TextInput
                    value={text}
                    onChangeText={setText}
                    multiline
                    style={styles.bodyInput}
                    placeholder={
                        kind === "voice"
                            ? "Tap the mic and speak — or type"
                            : "Why this matters for the venture (optional)"
                    }
                    placeholderTextColor={color.mist}
                    maxLength={2000}
                />
                {dictation.supported ? (
                    <Pressable
                        onPress={() => {
                            tapHaptic();
                            dictation.toggle();
                        }}
                        style={[styles.micButton, dictation.listening && styles.micListening]}
                        accessibilityRole="button"
                        accessibilityLabel={dictation.listening ? "Stop dictation" : "Dictate"}
                    >
                        <IconSparkle size={16} color={dictation.listening ? color.paper : color.brassDeep} />
                    </Pressable>
                ) : null}
            </View>
            {dictation.listening ? <Text style={styles.listening}>Listening… speak now.</Text> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button label={busy ? "Sharing…" : "Share with Jua"} onPress={() => void handleShare()} busy={busy} />
        </Card>
    );
}

/**
 * One shared item through its life: pending (Jua reading) → parsed
 * (recommendation with confidence) → applied (context card with measured
 * outcome). The beautifului patterns — context card, recommendation card,
 * insight card — in the ledger language.
 */
export function WisdomItemCard({
    item,
    ventureName,
    onApplied,
}: {
    item: WisdomItem;
    ventureName: string;
    onApplied?: () => void;
}) {
    const applyWisdom = useMutation(api.wisdom.applyWisdom);
    const discardWisdom = useMutation(api.wisdom.discardWisdom);
    const [busy, setBusy] = useState(false);

    const host = hostOf(item.sourceUrl);

    async function handleApply() {
        setBusy(true);
        try {
            await applyWisdom({ itemId: item.id });
            onApplied?.();
        } finally {
            setBusy(false);
        }
    }

    // Pending — Jua is reading; show the source, not a fake summary.
    if (item.status === "pending") {
        return (
            <Card>
                <View style={styles.titleRow}>
                    {kindGlyph(item.kind, 14)}
                    <Text style={styles.cardTitle}>Jua is reading…</Text>
                    <Text style={styles.meta}>{item.kind}</Text>
                </View>
                <View style={styles.shimmerTrack}>
                    <View style={styles.shimmerBar} />
                </View>
                <Text style={styles.hint}>
                    {host ? `Reading ${host}` : "Distilling it for"} {ventureName}.
                </Text>
            </Card>
        );
    }

    // Applied — the context card with its measured outcome.
    if (item.status === "applied" && item.parse) {
        return (
            <Card variant="artifact" style={styles.appliedCard}>
                <View style={styles.titleRow}>
                    {kindGlyph(item.kind, 14)}
                    <Text style={styles.cardTitle}>{item.parse.application.title}</Text>
                    <Text style={styles.metaApplied}>applied</Text>
                </View>
                <Text style={styles.body}>{item.parse.application.body}</Text>
                {item.outcomeValue != null && item.outcomeValue > 0 ? (
                    <View style={styles.outcomeRow}>
                        <IconSparkle size={13} color={color.success} />
                        <Text style={styles.outcomeText}>
                            KPI +{item.outcomeValue} measured since it was applied
                        </Text>
                    </View>
                ) : (
                    <Text style={styles.hint}>Outcome lands here as check-ins arrive.</Text>
                )}
            </Card>
        );
    }

    // Parsed — the recommendation: summary, principles, application, confidence.
    if (!item.parse) return null;
    return (
        <Card variant="trust">
            <View style={styles.titleRow}>
                {kindGlyph(item.kind, 14)}
                <Text style={styles.cardTitle}>Jua proposes applying this</Text>
                <Text style={styles.meta}>{host ?? item.kind}</Text>
            </View>
            <Text style={styles.body}>{item.parse.summary}</Text>
            {item.parse.principles.length > 0 ? (
                <View style={styles.principles}>
                    {item.parse.principles.map((principle) => (
                        <View key={principle} style={styles.principleRow}>
                            <View style={styles.principleDot} />
                            <Text style={styles.principleText}>{principle}</Text>
                        </View>
                    ))}
                </View>
            ) : null}
            <View style={styles.application}>
                <Text style={styles.applicationLabel}>For {ventureName}</Text>
                <Text style={styles.applicationTitle}>{item.parse.application.title}</Text>
                <Text style={styles.applicationBody}>{item.parse.application.body}</Text>
            </View>
            <View style={styles.confidenceRow}>
                <Text style={styles.confidenceLabel}>
                    Confidence {Math.round(item.parse.confidence * 100)}%
                </Text>
                <View style={styles.confidenceTrack}>
                    <View style={[styles.confidenceFill, { width: `${item.parse.confidence * 100}%` }]} />
                </View>
            </View>
            <Button label={`Approve & share with ${ventureName}`} variant="approve" onPress={() => void handleApply()} disabled={busy} busy={busy} />
            <Pressable onPress={() => void discardWisdom({ itemId: item.id })} hitSlop={6} disabled={busy}>
                <Text style={styles.discard}>Not for this venture</Text>
            </Pressable>
        </Card>
    );
}

const styles = StyleSheet.create({
    shareToggle: { alignSelf: "flex-start" },
    cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
    titleRow: { flexDirection: "row", alignItems: "center", gap: 7, flex: 1 },
    cardTitle: {
        fontFamily: font.displayMedium,
        fontSize: 18,
        fontWeight: "600",
        color: color.charcoal,
        flexShrink: 1,
    },
    close: { fontFamily: font.bodyBold, fontSize: 12, fontWeight: "700", color: color.mist },
    hint: { fontFamily: font.body, fontSize: 12, lineHeight: 17, color: color.mist },
    kindRow: { gap: 6, paddingVertical: 2 },
    composerRow: { flexDirection: "row", gap: 8, alignItems: "flex-end" },
    bodyInput: {
        flex: 1,
        minHeight: 64,
        maxHeight: 120,
        borderWidth: 1,
        borderColor: color.lineStrong,
        borderRadius: 4,
        paddingHorizontal: 12,
        paddingVertical: 10,
        color: color.ink,
        backgroundColor: color.paper,
        fontFamily: font.body,
        fontSize: 14,
        textAlignVertical: "top",
    },
    micButton: {
        width: 44,
        height: 44,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: color.brass,
        backgroundColor: color.paper,
        alignItems: "center",
        justifyContent: "center",
    },
    micListening: { backgroundColor: color.brass },
    listening: { fontFamily: font.bodyBold, fontSize: 11, fontWeight: "700", color: color.brassDeep },
    error: { fontFamily: font.body, fontSize: 12, color: color.danger },
    meta: {
        fontFamily: font.bodyBold,
        fontSize: 10,
        fontWeight: "700",
        letterSpacing: 0.5,
        textTransform: "uppercase",
        color: color.mist,
    },
    metaApplied: {
        fontFamily: font.bodyBold,
        fontSize: 10,
        fontWeight: "700",
        letterSpacing: 0.5,
        textTransform: "uppercase",
        color: color.success,
    },
    body: { fontFamily: font.body, fontSize: 13, lineHeight: 19, color: color.ink },
    principles: { gap: 6 },
    principleRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
    principleDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: color.brass, marginTop: 6 },
    principleText: { flex: 1, fontFamily: font.body, fontSize: 12, lineHeight: 17, color: color.ink },
    application: {
        gap: 4,
        padding: 12,
        borderRadius: 4,
        backgroundColor: color.brassSoft,
        borderWidth: 1,
        borderColor: "rgba(166,124,45,0.25)",
    },
    applicationLabel: {
        fontFamily: font.bodyBold,
        fontSize: 9,
        fontWeight: "700",
        letterSpacing: 0.8,
        textTransform: "uppercase",
        color: color.brassDeep,
    },
    applicationTitle: {
        fontFamily: font.displayMedium,
        fontSize: 16,
        fontWeight: "600",
        color: color.charcoal,
    },
    applicationBody: { fontFamily: font.body, fontSize: 13, lineHeight: 19, color: color.ink },
    confidenceRow: { gap: 6 },
    confidenceLabel: {
        fontFamily: font.bodyBold,
        fontSize: 10,
        fontWeight: "700",
        letterSpacing: 0.5,
        textTransform: "uppercase",
        color: color.mist,
    },
    confidenceTrack: { height: 3, borderRadius: 2, backgroundColor: "rgba(20,24,22,0.08)", overflow: "hidden" },
    confidenceFill: { height: "100%", backgroundColor: color.brass },
    discard: {
        fontFamily: font.bodyBold,
        fontSize: 12,
        fontWeight: "700",
        color: color.mist,
        textAlign: "center",
        paddingVertical: 6,
    },
    appliedCard: { gap: 10 },
    outcomeRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    outcomeText: {
        fontFamily: font.bodyBold,
        fontSize: 12,
        fontWeight: "700",
        color: color.success,
        fontVariant: ["tabular-nums"],
    },
    // Gentle read-in shimmer for the pending card.
    shimmerTrack: { height: 2, borderRadius: 99, overflow: "hidden", backgroundColor: "rgba(166,124,45,0.12)" },
    shimmerBar: { width: "40%", height: "100%", backgroundColor: color.brass, borderRadius: 99, opacity: 0.7 },
});
