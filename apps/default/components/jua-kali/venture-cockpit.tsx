import { useState } from "react";
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    useWindowDimensions,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import { SITE_URL } from "@/lib/site";
import { SoftIdentityBar } from "@/components/jua-kali/soft-identity";
import { LivingSun } from "@/components/jua-kali/living-sun";
import { IconArrowRight, IconLedger, IconSparkle, IconTrend } from "@/components/jua-kali/icons";
import { Button, Card, Chip } from "@/components/jua-kali/ui";
import { WisdomItemCard } from "@/components/jua-kali/wisdom";
import { useDictation } from "@/components/jua-kali/hooks/use-dictation";
import { tapHaptic } from "@/components/jua-kali/haptics";
import { color, font, layout, tabularNums } from "@/components/jua-kali/theme";

type UpdateTag = "situation" | "problem" | "opportunity" | "win";

const TAGS: Array<{ id: UpdateTag; label: string }> = [
    { id: "situation", label: "Situation" },
    { id: "problem", label: "Problem" },
    { id: "opportunity", label: "Opportunity" },
    { id: "win", label: "Win" },
];

function relativeTime(ts: number): string {
    const mins = Math.floor((Date.now() - ts) / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

/**
 * The entrepreneur's cockpit — their side of the loop. Their sun rises with
 * their KPI; mentor wisdom arrives as applied context cards with measured
 * outcomes; sharing a situation goes through Jua, who turns it into the
 * digest their mentors read and the ledger proves.
 */
export function VentureCockpit({ onOpenLedger }: { onOpenLedger?: () => void }) {
    const insets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    const padX = Math.max(14, Math.min(28, (width - layout.maxWidth) / 2 + 16));

    const venture = useQuery(api.venture.myVenture);
    const claimVenture = useMutation(api.venture.claimVenture);
    const postUpdate = useMutation(api.venture.postVentureUpdate);
    const logCheckIn = useMutation(api.venture.logSelfCheckIn);

    const [claiming, setClaiming] = useState(false);
    const [tag, setTag] = useState<UpdateTag>("situation");
    const [body, setBody] = useState("");
    const [kpiText, setKpiText] = useState("");
    const [status, setStatus] = useState<string | null>(null);
    const [sending, setSending] = useState(false);
    const dictation = useDictation((transcript) =>
        setBody((prev) => (prev ? `${prev} ${transcript}` : transcript)),
    );

    async function handleClaim() {
        setClaiming(true);
        setStatus(null);
        try {
            const result = await claimVenture({});
            setStatus(result.message);
        } catch (e) {
            setStatus(e instanceof Error ? e.message : "Could not claim.");
        } finally {
            setClaiming(false);
        }
    }

    async function handleUpdate() {
        const text = body.trim();
        if (!text) {
            setStatus("Write a few words first.");
            return;
        }
        const kpiValue = kpiText.trim() ? Number(kpiText) : undefined;
        setSending(true);
        setStatus(null);
        try {
            const result = await postUpdate({
                body: text,
                tag,
                kpiValue: Number.isFinite(kpiValue) && kpiValue && kpiValue > 0 ? kpiValue : undefined,
            });
            setStatus(result.message);
            setBody("");
            setKpiText("");
        } catch (e) {
            setStatus(e instanceof Error ? e.message : "Could not send.");
        } finally {
            setSending(false);
        }
    }

    async function handleCheckIn() {
        const value = Number(kpiText);
        if (!Number.isFinite(value) || value <= 0) {
            setStatus("Enter your number for this week.");
            return;
        }
        setSending(true);
        try {
            const result = await logCheckIn({ value, note: body.trim() || undefined });
            setStatus(result.message);
            setKpiText("");
        } catch (e) {
            setStatus(e instanceof Error ? e.message : "Could not log.");
        } finally {
            setSending(false);
        }
    }

    if (venture === undefined) {
        return (
            <View style={[styles.screen, { paddingTop: insets.top }]}>
                <ActivityIndicator color={color.brass} />
            </View>
        );
    }

    // No venture yet — the claim card (demo entry: ?venture=1).
    if (venture === null) {
        return (
            <View style={[styles.screen, { paddingTop: insets.top + 16 }]}>
                <ScrollView
                    contentContainerStyle={[styles.content, { paddingHorizontal: padX, maxWidth: layout.maxWidth, width: "100%", alignSelf: "center" }]}
                    showsVerticalScrollIndicator={false}
                >
                    <Card>
                        <View style={styles.titleRow}>
                            <LivingSun progress={0.3} size={18} />
                            <Text style={styles.title}>Run your venture</Text>
                        </View>
                        <Text style={styles.body}>
                            This is the founder side of JuaKali — your KPI, the wisdom your mentors
                            share, and a direct line to Jua. Sign in and claim a demo venture to
                            see it live.
                        </Text>
                        <SoftIdentityBar forceOpen heading="Sign in to claim your venture" />
                        <Button
                            label={claiming ? "Claiming…" : "Claim a demo venture"}
                            onPress={() => void handleClaim()}
                            busy={claiming}
                        />
                        {status ? <Text style={styles.status}>{status}</Text> : null}
                    </Card>
                </ScrollView>
            </View>
        );
    }

    const progress =
        venture.kpiTarget > 0 ? Math.min(1, venture.kpiTotal / venture.kpiTarget) : 0;

    return (
        <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
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
                {/* Their sun rises with their own number. */}
                <View style={styles.hero}>
                    <LivingSun progress={progress} size={44} />
                    <View style={styles.heroBody}>
                        <Text style={styles.title}>{venture.name}</Text>
                        <Text style={styles.sub}>
                            {venture.craftText} · {venture.locationText}
                        </Text>
                    </View>
                </View>

                <Card>
                    <View style={styles.kpiRow}>
                        <View style={styles.kpiBlock}>
                            <Text style={styles.kpiValue}>{venture.kpiTotal}</Text>
                            <Text style={styles.kpiLabel}>{venture.kpiLabel.toLowerCase()}</Text>
                        </View>
                        <View style={styles.kpiDivider} />
                        <View style={styles.kpiBlock}>
                            <Text style={styles.kpiValue}>{venture.kpiTarget}</Text>
                            <Text style={styles.kpiLabel}>target</Text>
                        </View>
                    </View>
                    <View style={styles.progressTrack}>
                        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
                    </View>
                    {status ? <Text style={styles.status}>{status}</Text> : null}
                </Card>

                {/* Share an update — the founder's voice, moderated by Jua. */}
                <Card>
                    <View style={styles.titleRow}>
                        <IconSparkle size={15} color={color.brassDeep} />
                        <Text style={styles.cardTitle}>Tell Jua what&apos;s happening</Text>
                    </View>
                    <Text style={styles.hint}>
                        Jua turns it into the digest your mentors read — nothing runs without you.
                    </Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tagRow}>
                        {TAGS.map((t) => (
                            <Chip key={t.id} label={t.label} active={tag === t.id} onPress={() => setTag(t.id)} />
                        ))}
                    </ScrollView>
                    <View style={styles.composerRow}>
                        <TextInput
                            value={body}
                            onChangeText={setBody}
                            multiline
                            style={styles.composerInput}
                            placeholder="What moved, what's stuck, what's next…"
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
                    {dictation.listening ? <Text style={styles.listening}>Listening…</Text> : null}
                    <View style={styles.kpiInputRow}>
                        <TextInput
                            value={kpiText}
                            onChangeText={setKpiText}
                            style={styles.kpiInput}
                            placeholder={`This week's ${venture.kpiLabel.toLowerCase()}`}
                            placeholderTextColor={color.mist}
                            keyboardType="number-pad"
                        />
                        <Button label="Send to Jua" onPress={() => void handleUpdate()} busy={sending} />
                    </View>
                    <Pressable onPress={() => void handleCheckIn()} hitSlop={6} accessibilityRole="button">
                        <Text style={styles.selfLink}>Log this number only (self check-in)</Text>
                    </Pressable>
                </Card>

                {/* Wisdom received — applied mentor advice with outcomes. */}
                <WisdomForVenture ventureId={venture.ventureId} ventureName={venture.name} />

                {venture.checkIns.length > 0 ? (
                    <Card>
                        <View style={styles.titleRow}>
                            <IconTrend size={15} color={color.brassDeep} />
                            <Text style={styles.cardTitle}>Your check-ins</Text>
                        </View>
                        {venture.checkIns.slice(0, 5).map((checkIn) => (
                            <View key={checkIn.id} style={styles.checkInRow}>
                                <Text style={styles.checkInValue}>+{checkIn.value}</Text>
                                <Text style={styles.checkInNote} numberOfLines={1}>
                                    {checkIn.note}
                                </Text>
                                <Text style={styles.checkInWhen}>{relativeTime(checkIn.createdAt)}</Text>
                            </View>
                        ))}
                    </Card>
                ) : null}

                {venture.recentDigests.length > 0 ? (
                    <Card variant="artifact">
                        <View style={styles.titleRow}>
                            <IconLedger size={15} color={color.brassDeep} />
                            <Text style={styles.cardTitle}>What your mentors read</Text>
                        </View>
                        {venture.recentDigests.map((digest) => (
                            <View key={digest.id} style={styles.digestRow}>
                                <Text style={styles.body}>{digest.summary}</Text>
                                <Text style={styles.checkInWhen}>{relativeTime(digest.createdAt)}</Text>
                            </View>
                        ))}
                    </Card>
                ) : null}

                {onOpenLedger ? (
                    <Button label="See my public proof" variant="ghost" onPress={onOpenLedger} icon={<IconArrowRight size={14} color={color.charcoal} />} style={styles.proofBtn} />
                ) : (
                    <Text style={styles.proofHint}>{SITE_URL}/deal/{venture.publicSlug}</Text>
                )}
            </ScrollView>
        </View>
    );
}

/** The owner's applied-wisdom list (live). */
function WisdomForVenture({ ventureId, ventureName }: { ventureId: string; ventureName: string }) {
    const items = useQuery(api.wisdom.wisdomForOwner, { ventureId: ventureId as never });
    if (items === undefined) return null;
    const applied = items.filter((item) => item.status === "applied");
    if (applied.length === 0) {
        return (
            <Card>
                <View style={styles.titleRow}>
                    <IconSparkle size={15} color={color.brassDeep} />
                    <Text style={styles.cardTitle}>Wisdom from your mentors</Text>
                </View>
                <Text style={styles.hint}>
                    When a mentor shares advice for {ventureName}, Jua shapes it into one action and
                    it lands here — with the result measured against your KPI.
                </Text>
            </Card>
        );
    }
    return (
        <View style={styles.wisdomStack}>
            {applied.map((item) => (
                <WisdomItemCard key={item.id} item={item} ventureName={ventureName} />
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.stone },
    content: { gap: 14, paddingTop: 8 },
    hero: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 6 },
    heroBody: { flex: 1, gap: 2 },
    title: {
        fontFamily: font.displayMedium,
        fontSize: 24,
        fontWeight: "600",
        letterSpacing: -0.5,
        color: color.charcoal,
    },
    sub: { fontFamily: font.body, fontSize: 12, color: color.mist },
    cardTitle: {
        fontFamily: font.displayMedium,
        fontSize: 18,
        fontWeight: "600",
        color: color.charcoal,
        flexShrink: 1,
    },
    titleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
    body: { fontFamily: font.body, fontSize: 13, lineHeight: 19, color: color.ink },
    hint: { fontFamily: font.body, fontSize: 12, lineHeight: 17, color: color.mist },
    status: { fontFamily: font.body, fontSize: 12, color: color.brassDeep, textAlign: "center" },
    kpiRow: { flexDirection: "row", alignItems: "center", gap: 16 },
    kpiBlock: { gap: 2, flex: 1 },
    kpiValue: {
        fontFamily: font.display,
        fontSize: 30,
        fontWeight: "700",
        letterSpacing: -0.8,
        color: color.charcoal,
        fontVariant: tabularNums,
    },
    kpiLabel: {
        fontFamily: font.bodyBold,
        fontSize: 10,
        fontWeight: "700",
        letterSpacing: 0.6,
        textTransform: "uppercase",
        color: color.mist,
    },
    kpiDivider: { width: 1, alignSelf: "stretch", backgroundColor: color.line },
    progressTrack: { height: 3, borderRadius: 2, backgroundColor: "rgba(20,24,22,0.08)", overflow: "hidden" },
    progressFill: { height: "100%", backgroundColor: color.brass },
    tagRow: { gap: 6, paddingVertical: 2 },
    composerRow: { flexDirection: "row", gap: 8, alignItems: "flex-end" },
    composerInput: {
        flex: 1,
        minHeight: 72,
        maxHeight: 140,
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
    kpiInputRow: { flexDirection: "row", gap: 8, alignItems: "center" },
    kpiInput: {
        flex: 1,
        borderWidth: 1,
        borderColor: color.lineStrong,
        borderRadius: 4,
        paddingHorizontal: 12,
        paddingVertical: 11,
        color: color.ink,
        backgroundColor: color.paper,
        fontFamily: font.body,
        fontSize: 15,
    },
    selfLink: {
        fontFamily: font.bodyBold,
        fontSize: 12,
        fontWeight: "700",
        color: color.brassDeep,
        textAlign: "center",
        paddingVertical: 4,
    },
    wisdomStack: { gap: 12 },
    checkInRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
    checkInValue: {
        fontFamily: font.bodyBold,
        fontSize: 13,
        fontWeight: "700",
        color: color.charcoal,
        minWidth: 36,
        fontVariant: tabularNums,
    },
    checkInNote: { flex: 1, fontFamily: font.body, fontSize: 12, color: color.ink },
    checkInWhen: { fontFamily: font.body, fontSize: 11, color: color.mist },
    digestRow: { gap: 2, paddingVertical: 4 },
    proofBtn: { alignSelf: "center" },
    proofHint: { fontFamily: font.body, fontSize: 11, color: color.mist, textAlign: "center" },
});
