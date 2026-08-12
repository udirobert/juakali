import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
    AccessibilityInfo,
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
import Animated, {
    FadeInDown,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withRepeat,
    withSpring,
    withTiming,
} from "react-native-reanimated";
import { useMutation, useQuery } from "convex/react";
import type { Id } from "@/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";

import { api } from "@/convex/_generated/api";
import { color, font, layout } from "@/components/jua-kali/theme";

type Cockpit = FunctionReturnType<typeof api.invest.investorCockpit>;
type Commitment = Cockpit["commitments"][number];
type ToolResult = { tool: string; detail: string; status: "running" | "done" };
type AgentPhase = "idle" | "queued" | "acting" | "done";

function formatKes(value: number) {
    return `KES ${value.toLocaleString()}`;
}

function formatDue(ts: number | null) {
    if (!ts) return "—";
    return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Sparkline({ values }: { values: number[] }) {
    if (values.length === 0) return null;
    const max = Math.max(...values, 1);
    return (
        <View style={styles.sparkRow}>
            {values.map((value, index) => (
                <View key={`${index}-${value}`} style={styles.sparkTrack}>
                    <View style={[styles.sparkBar, { height: Math.max(3, Math.round((value / max) * 28)) }]} />
                </View>
            ))}
        </View>
    );
}

function WaitingShimmer({ active }: { active: boolean }) {
    const reduceMotion = useReducedMotion();
    const progress = useSharedValue(0);

    useEffect(() => {
        if (!active || reduceMotion) {
            progress.value = 0;
            return;
        }
        progress.value = withRepeat(withTiming(1, { duration: 900 }), -1, true);
    }, [active, progress, reduceMotion]);

    const style = useAnimatedStyle(() => ({
        opacity: active ? 0.45 + progress.value * 0.4 : 0,
        transform: [{ translateX: (progress.value - 0.5) * 48 }],
    }));

    if (!active) return null;
    return (
        <View style={styles.shimmerTrack} accessibilityElementsHidden>
            <Animated.View style={[styles.shimmerBar, style]} />
        </View>
    );
}

function PressableScale({
    onPress,
    disabled,
    style,
    children,
}: {
    onPress: () => void;
    disabled?: boolean;
    style?: object | object[];
    children: ReactNode;
}) {
    const reduceMotion = useReducedMotion();
    const scale = useSharedValue(1);
    const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

    return (
        <Pressable
            disabled={disabled}
            onPressIn={() => {
                if (!reduceMotion) scale.value = withSpring(0.97, { damping: 20, stiffness: 400 });
            }}
            onPressOut={() => {
                if (!reduceMotion) scale.value = withSpring(1, { damping: 18, stiffness: 320 });
            }}
            onPress={onPress}
        >
            <Animated.View style={[style, anim, disabled && styles.disabled]}>{children}</Animated.View>
        </Pressable>
    );
}

export function InvestorCockpit() {
    const data = useQuery(api.invest.investorCockpit, {});
    const seedInvestDemo = useMutation(api.invest.seedInvestDemo);
    const pledgeCommitment = useMutation(api.invest.pledgeCommitment);
    const sendInvestorEmail = useMutation(api.invest.sendInvestorEmail);
    const insets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    const compact = width < 440;
    const padX = Math.max(14, Math.min(28, (width - layout.maxWidth) / 2 + 16));

    const [selectedCommitmentId, setSelectedCommitmentId] = useState<Id<"commitments"> | null>(null);
    const [selectedVentureId, setSelectedVentureId] = useState<Id<"ventures"> | null>(null);
    const [amountText, setAmountText] = useState("10000");
    const [emailDraft, setEmailDraft] = useState("Push follow-ups this week. Reply with what moved.");
    const [pendingBody, setPendingBody] = useState<string | null>(null);
    const [agentPhase, setAgentPhase] = useState<AgentPhase>("idle");
    const [toolResults, setToolResults] = useState<ToolResult[]>([]);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [isSeeding, setIsSeeding] = useState(false);
    const [isPledging, setIsPledging] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [showPledge, setShowPledge] = useState(false);
    const [showThread, setShowThread] = useState(false);
    const [actingSeconds, setActingSeconds] = useState(0);

    const selectedCommitment: Commitment | null = useMemo(() => {
        if (!data || data.commitments.length === 0) return null;
        const id = selectedCommitmentId ?? data.commitments[0]!.id;
        return data.commitments.find((row) => row.id === id) ?? data.commitments[0]!;
    }, [data, selectedCommitmentId]);

    const selectedVenture = useMemo(() => {
        if (!data) return null;
        const id = selectedVentureId ?? data.availableVentures[0]?.id ?? null;
        return data.availableVentures.find((venture) => venture.id === id) ?? null;
    }, [data, selectedVentureId]);

    const waiting = agentPhase === "queued" || agentPhase === "acting";
    const empty = data !== undefined && data.commitments.length === 0;

    useEffect(() => {
        if (agentPhase !== "acting") {
            setActingSeconds(0);
            return;
        }
        const started = Date.now();
        const id = setInterval(() => setActingSeconds(Math.floor((Date.now() - started) / 1000)), 250);
        return () => clearInterval(id);
    }, [agentPhase]);

    async function handleSeed() {
        setIsSeeding(true);
        try {
            const result = await seedInvestDemo({});
            setStatusMessage(result.message);
        } catch (error) {
            setStatusMessage(error instanceof Error ? error.message : "Could not seed.");
        } finally {
            setIsSeeding(false);
        }
    }

    async function handlePledge() {
        if (!selectedVenture) return;
        const amountKes = Number(amountText);
        if (!Number.isFinite(amountKes) || amountKes <= 0) {
            setStatusMessage("Enter a positive KES amount.");
            return;
        }
        setIsPledging(true);
        try {
            const result = await pledgeCommitment({ ventureId: selectedVenture.id, amountKes });
            setSelectedCommitmentId(result.commitmentId);
            setStatusMessage(result.message);
            setShowPledge(false);
        } catch (error) {
            setStatusMessage(error instanceof Error ? error.message : "Could not pledge.");
        } finally {
            setIsPledging(false);
        }
    }

    function handleQueueEmail() {
        const body = emailDraft.trim();
        if (!body || !selectedCommitment) return;
        setPendingBody(body);
        setAgentPhase("queued");
        setToolResults([]);
        setStatusMessage(null);
        void AccessibilityInfo.announceForAccessibility("Queued. Awaiting approval.");
    }

    function handleDiscardQueue() {
        setPendingBody(null);
        setAgentPhase("idle");
    }

    async function handleApproveEmail() {
        if (!pendingBody || !selectedCommitment) return;
        setIsSending(true);
        setAgentPhase("acting");
        setToolResults([
            { tool: "KPI", detail: "Logging…", status: "running" },
            { tool: "Digest", detail: "Writing…", status: "running" },
            { tool: "Ledger", detail: "Publishing…", status: "running" },
            { tool: "Reply", detail: "Sending…", status: "running" },
        ]);

        try {
            const result = await sendInvestorEmail({
                commitmentId: selectedCommitment.id,
                body: pendingBody,
            });
            await new Promise((resolve) => setTimeout(resolve, 380));
            setToolResults(
                result.toolResults.map((row) => ({
                    tool: row.tool.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 18),
                    detail: row.detail,
                    status: "done" as const,
                }))
            );
            setPendingBody(null);
            setEmailDraft("");
            setAgentPhase("done");
            setStatusMessage(result.message);
            void AccessibilityInfo.announceForAccessibility("Done. Digest and ledger updated.");
        } catch (error) {
            setToolResults((prev) =>
                prev.map((row) => ({
                    ...row,
                    status: "done" as const,
                    detail: error instanceof Error ? error.message : "Failed",
                }))
            );
            setAgentPhase("idle");
            setStatusMessage(error instanceof Error ? error.message : "Could not send.");
        } finally {
            setIsSending(false);
        }
    }

    if (data === undefined) {
        return (
            <View style={[styles.loadingScreen, { paddingTop: insets.top }]}>
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
                    <View style={styles.heroRow}>
                        <Text style={styles.brand}>JuaKali</Text>
                        <PressableScale onPress={() => setShowPledge((v) => !v)} style={styles.btnGhost}>
                            <Text style={styles.btnGhostText}>{showPledge ? "Close" : "Pledge"}</Text>
                        </PressableScale>
                    </View>
                    {empty ? (
                        <PressableScale
                            onPress={handleSeed}
                            disabled={isSeeding}
                            style={[styles.btnPrimary, isSeeding && styles.disabled]}
                        >
                            <Text style={styles.btnPrimaryText}>{isSeeding ? "…" : "Seed"}</Text>
                        </PressableScale>
                    ) : null}
                    {statusMessage ? <Text style={styles.status}>{statusMessage}</Text> : null}
                </View>

                {showPledge ? (
                    <Animated.View entering={FadeInDown.duration(180)} style={styles.card}>
                        <View style={styles.chipRow}>
                            {data.availableVentures.map((venture) => (
                                <Pressable
                                    key={venture.id}
                                    onPress={() => setSelectedVentureId(venture.id)}
                                    style={[styles.chip, selectedVenture?.id === venture.id && styles.chipOn]}
                                >
                                    <Text style={[styles.chipText, selectedVenture?.id === venture.id && styles.chipTextOn]}>
                                        {venture.name}
                                    </Text>
                                </Pressable>
                            ))}
                        </View>
                        <TextInput
                            value={amountText}
                            onChangeText={setAmountText}
                            keyboardType="number-pad"
                            style={styles.input}
                            placeholder="KES"
                            placeholderTextColor={color.mist}
                        />
                        <PressableScale
                            onPress={handlePledge}
                            disabled={isPledging || !selectedVenture}
                            style={styles.btnPrimary}
                        >
                            <Text style={styles.btnPrimaryText}>{isPledging ? "…" : "Commit"}</Text>
                        </PressableScale>
                    </Animated.View>
                ) : null}

                {empty ? (
                    <View style={styles.emptyCard}>
                        <View style={styles.emptyGlyph}>
                            <View style={styles.emptyRing} />
                            <View style={[styles.emptyRing, styles.emptyRingInner]} />
                        </View>
                        <Text style={styles.emptyTitle}>Start with one venture</Text>
                        <PressableScale onPress={handleSeed} disabled={isSeeding} style={styles.btnPrimary}>
                            <Text style={styles.btnPrimaryText}>{isSeeding ? "…" : "Seed demo"}</Text>
                        </PressableScale>
                    </View>
                ) : (
                    <>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
                            {data.commitments.map((row) => {
                                const on = selectedCommitment?.id === row.id;
                                return (
                                    <Pressable
                                        key={row.id}
                                        onPress={() => setSelectedCommitmentId(row.id)}
                                        style={[styles.stripItem, on && styles.stripItemOn]}
                                    >
                                        <Text style={[styles.stripName, on && styles.stripNameOn]} numberOfLines={1}>
                                            {row.venture.name}
                                        </Text>
                                        <Text style={styles.stripAmt}>{formatKes(row.amountKes)}</Text>
                                    </Pressable>
                                );
                            })}
                        </ScrollView>

                        {selectedCommitment ? (
                            <View style={styles.stack}>
                                <Scorecard commitment={selectedCommitment} compact={compact} />
                                <Ritual
                                    commitment={selectedCommitment}
                                    draft={emailDraft}
                                    onChangeDraft={setEmailDraft}
                                    pendingBody={pendingBody}
                                    agentPhase={agentPhase}
                                    toolResults={toolResults}
                                    waiting={waiting}
                                    actingSeconds={actingSeconds}
                                    showThread={showThread}
                                    onToggleThread={() => setShowThread((v) => !v)}
                                    onQueue={handleQueueEmail}
                                    onApprove={handleApproveEmail}
                                    onDiscard={handleDiscardQueue}
                                    sending={isSending}
                                    compact={compact}
                                />
                            </View>
                        ) : null}
                    </>
                )}
            </ScrollView>
        </View>
    );
}

function Scorecard({ commitment, compact }: { commitment: Commitment; compact: boolean }) {
    const { venture } = commitment;
    const peer = venture.peerMedian;
    const progress = venture.kpiTarget > 0 ? Math.min(1, venture.kpiTotal / venture.kpiTarget) : 0;

    return (
        <View style={styles.card}>
            <View style={styles.cardTop}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                    {venture.name}
                </Text>
                <Text style={styles.meta}>Due {formatDue(commitment.nextDigestAt)}</Text>
            </View>

            <View style={styles.metrics}>
                <Metric value={venture.kpiTotal} label={venture.kpiLabel} />
                <Metric value={venture.kpiTarget} label="Target" />
                <Metric value={peer ?? "—"} label="Peers" />
            </View>

            <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
            </View>
            <Sparkline values={venture.sparkline} />

            {commitment.latestDigest ? (
                <View style={styles.insight}>
                    <Text style={styles.insightLabel}>Digest</Text>
                    <Text style={styles.insightBody} numberOfLines={compact ? 2 : 3}>
                        {commitment.latestDigest.summary}
                    </Text>
                </View>
            ) : null}
        </View>
    );
}

function Metric({ value, label }: { value: number | string; label: string }) {
    return (
        <View style={styles.metric}>
            <Text style={styles.metricValue}>{value}</Text>
            <Text style={styles.metricLabel}>{label}</Text>
        </View>
    );
}

function Ritual({
    commitment,
    draft,
    onChangeDraft,
    pendingBody,
    agentPhase,
    toolResults,
    waiting,
    actingSeconds,
    showThread,
    onToggleThread,
    onQueue,
    onApprove,
    onDiscard,
    sending,
    compact,
}: {
    commitment: Commitment;
    draft: string;
    onChangeDraft: (value: string) => void;
    pendingBody: string | null;
    agentPhase: AgentPhase;
    toolResults: ToolResult[];
    waiting: boolean;
    actingSeconds: number;
    showThread: boolean;
    onToggleThread: () => void;
    onQueue: () => void;
    onApprove: () => void;
    onDiscard: () => void;
    sending: boolean;
    compact: boolean;
}) {
    const emails = commitment.recentEmails;
    const phaseLabel =
        agentPhase === "queued"
            ? "Awaiting you"
            : agentPhase === "acting"
              ? `Acting · ${actingSeconds}s`
              : agentPhase === "done"
                ? "Done"
                : "Ready";

    return (
        <View style={styles.card}>
            <View style={styles.cardTop}>
                <Text style={styles.cardTitle}>Agent</Text>
                <Text style={styles.meta}>{phaseLabel}</Text>
            </View>

            <WaitingShimmer active={waiting} />

            {toolResults.length > 0 ? (
                <View style={styles.toolRow}>
                    {toolResults.map((result, index) => (
                        <View
                            key={`${result.tool}-${index}`}
                            style={[styles.toolChip, result.status === "running" && styles.toolChipRun]}
                        >
                            {result.status === "running" ? (
                                <ActivityIndicator size="small" color={color.brass} />
                            ) : (
                                <Text style={styles.toolOk}>✓</Text>
                            )}
                            <Text style={styles.toolName} numberOfLines={1}>
                                {result.tool}
                            </Text>
                        </View>
                    ))}
                </View>
            ) : null}

            {pendingBody ? (
                <Animated.View entering={FadeInDown.duration(160)} style={styles.gate}>
                    <Text style={styles.gateBody} numberOfLines={compact ? 3 : 5}>
                        {pendingBody}
                    </Text>
                    <PressableScale onPress={onApprove} disabled={sending} style={styles.btnPrimary}>
                        <Text style={styles.btnPrimaryText}>{sending ? "…" : "Approve"}</Text>
                    </PressableScale>
                    <Pressable onPress={onDiscard}>
                        <Text style={styles.discard}>Discard</Text>
                    </Pressable>
                </Animated.View>
            ) : (
                <View style={styles.composer}>
                    <TextInput
                        value={draft}
                        onChangeText={onChangeDraft}
                        multiline
                        style={styles.composerInput}
                        placeholder="Note to agent…"
                        placeholderTextColor={color.mist}
                        maxLength={320}
                    />
                    <PressableScale onPress={onQueue} style={styles.btnPrimary}>
                        <Text style={styles.btnPrimaryText}>Queue</Text>
                    </PressableScale>
                </View>
            )}

            {emails.length > 0 ? (
                <Pressable onPress={onToggleThread}>
                    <Text style={styles.threadToggle}>
                        {showThread ? "Hide thread" : `Thread · ${emails.length}`}
                    </Text>
                </Pressable>
            ) : null}
            {showThread
                ? emails.map((email) => (
                      <View key={email.id} style={styles.bubble}>
                          <Text style={styles.bubbleMeta}>
                              {email.direction === "inbound" ? "You" : "Agent"}
                          </Text>
                          <Text style={styles.bubbleBody} numberOfLines={4}>
                              {email.body}
                          </Text>
                      </View>
                  ))
                : null}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.stone },
    loadingScreen: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: color.stone },
    content: { gap: 14, paddingTop: 8 },
    hero: { gap: 10 },
    heroRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    brand: {
        fontFamily: font.display,
        fontSize: 28,
        fontWeight: "700",
        letterSpacing: -1,
        color: color.charcoal,
    },
    heroActions: { flexDirection: "row", gap: 8, justifyContent: "center" },
    btnPrimary: {
        backgroundColor: color.charcoal,
        paddingHorizontal: 18,
        paddingVertical: 12,
        borderRadius: 4,
        minHeight: 44,
        justifyContent: "center",
        alignItems: "center",
    },
    btnPrimaryText: {
        fontFamily: font.bodyBold,
        color: color.paper,
        fontWeight: "700",
        fontSize: 13,
    },
    btnGhost: {
        borderWidth: 1,
        borderColor: color.lineStrong,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 4,
        minHeight: 44,
        justifyContent: "center",
        backgroundColor: color.paper,
    },
    btnGhostText: { fontFamily: font.bodyBold, color: color.charcoal, fontWeight: "700", fontSize: 13 },
    disabled: { opacity: 0.45 },
    status: { fontFamily: font.body, fontSize: 12, color: color.brass, textAlign: "center" },
    card: {
        gap: 12,
        padding: 16,
        backgroundColor: color.paper,
        borderWidth: 1,
        borderColor: color.line,
        borderRadius: 6,
    },
    cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
    cardTitle: {
        fontFamily: font.displayMedium,
        fontSize: 20,
        fontWeight: "600",
        color: color.charcoal,
        flex: 1,
    },
    meta: { fontFamily: font.bodyBold, fontSize: 11, fontWeight: "700", color: color.brass },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    chip: {
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 4,
        backgroundColor: color.stone,
    },
    chipOn: { backgroundColor: color.brassSoft, borderWidth: 1, borderColor: color.brass },
    chipText: { fontFamily: font.bodyMedium, fontSize: 12, color: color.ink },
    chipTextOn: { fontWeight: "700", color: color.charcoal },
    input: {
        borderWidth: 1,
        borderColor: color.lineStrong,
        borderRadius: 4,
        paddingHorizontal: 12,
        paddingVertical: 10,
        color: color.ink,
        backgroundColor: color.stone,
        fontFamily: font.body,
        fontSize: 15,
    },
    emptyCard: { alignItems: "center", gap: 14, paddingVertical: 28 },
    emptyGlyph: { width: 72, height: 72, alignItems: "center", justifyContent: "center" },
    emptyRing: {
        position: "absolute",
        width: 64,
        height: 64,
        borderRadius: 32,
        borderWidth: 1.5,
        borderColor: color.brass,
        opacity: 0.5,
    },
    emptyRingInner: { width: 40, height: 40, borderRadius: 20, opacity: 0.9 },
    emptyTitle: {
        fontFamily: font.displayMedium,
        fontSize: 18,
        fontWeight: "600",
        color: color.charcoal,
    },
    strip: { gap: 8, paddingVertical: 2 },
    stripItem: {
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 4,
        backgroundColor: color.paper,
        borderWidth: 1,
        borderColor: color.line,
        minWidth: 120,
        gap: 2,
    },
    stripItemOn: { borderColor: color.brass, backgroundColor: color.brassSoft },
    stripName: { fontFamily: font.bodyBold, fontSize: 12, fontWeight: "700", color: color.ink },
    stripNameOn: { color: color.charcoal },
    stripAmt: { fontFamily: font.body, fontSize: 11, color: color.brass },
    stack: { gap: 12 },
    metrics: { flexDirection: "row", gap: 8 },
    metric: { flex: 1, padding: 10, borderRadius: 4, backgroundColor: color.stone, gap: 2 },
    metricValue: {
        fontFamily: font.display,
        fontSize: 22,
        fontWeight: "700",
        color: color.charcoal,
        letterSpacing: -0.4,
    },
    metricLabel: {
        fontFamily: font.bodyBold,
        fontSize: 9,
        fontWeight: "700",
        color: color.mist,
        textTransform: "uppercase",
        letterSpacing: 0.5,
    },
    progressTrack: {
        height: 3,
        borderRadius: 2,
        backgroundColor: "rgba(20,24,22,0.08)",
        overflow: "hidden",
    },
    progressFill: { height: "100%", backgroundColor: color.brass },
    sparkRow: { flexDirection: "row", alignItems: "flex-end", gap: 4, height: 32 },
    sparkTrack: {
        flex: 1,
        height: 32,
        justifyContent: "flex-end",
        backgroundColor: "rgba(20,24,22,0.04)",
        borderRadius: 2,
        overflow: "hidden",
    },
    sparkBar: { width: "100%", backgroundColor: color.charcoal, borderRadius: 2 },
    insight: {
        gap: 4,
        padding: 12,
        borderRadius: 4,
        backgroundColor: color.brassSoft,
        borderWidth: 1,
        borderColor: "rgba(166,124,45,0.25)",
    },
    insightLabel: {
        fontFamily: font.bodyBold,
        fontSize: 10,
        fontWeight: "700",
        color: color.brass,
        letterSpacing: 0.6,
        textTransform: "uppercase",
    },
    insightBody: { fontFamily: font.body, fontSize: 13, lineHeight: 18, color: color.ink },
    shimmerTrack: {
        height: 2,
        borderRadius: 99,
        overflow: "hidden",
        backgroundColor: "rgba(166,124,45,0.12)",
    },
    shimmerBar: { width: "40%", height: "100%", backgroundColor: color.brass, borderRadius: 99 },
    toolRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    toolChip: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 4,
        backgroundColor: color.stone,
        maxWidth: "48%",
    },
    toolChipRun: { backgroundColor: color.brassSoft },
    toolOk: { color: color.success, fontWeight: "700", fontSize: 12 },
    toolName: { fontFamily: font.bodyBold, fontSize: 11, fontWeight: "700", color: color.charcoal, flexShrink: 1 },
    gate: { gap: 10 },
    gateBody: { fontFamily: font.body, fontSize: 14, lineHeight: 20, color: color.ink },
    discard: {
        fontFamily: font.bodyBold,
        fontSize: 13,
        fontWeight: "700",
        color: color.mist,
        textAlign: "center",
        paddingVertical: 8,
    },
    composer: { gap: 10 },
    composerInput: {
        minHeight: 64,
        maxHeight: 100,
        borderWidth: 1,
        borderColor: color.lineStrong,
        borderRadius: 4,
        paddingHorizontal: 12,
        paddingVertical: 10,
        color: color.ink,
        backgroundColor: color.stone,
        fontFamily: font.body,
        fontSize: 14,
        textAlignVertical: "top",
    },
    threadToggle: { fontFamily: font.bodyBold, fontSize: 12, fontWeight: "700", color: color.brass },
    bubble: { gap: 2, padding: 10, borderRadius: 4, backgroundColor: color.stone },
    bubbleMeta: { fontFamily: font.bodyBold, fontSize: 10, fontWeight: "700", color: color.mist },
    bubbleBody: { fontFamily: font.body, fontSize: 12, lineHeight: 17, color: color.ink },
});
