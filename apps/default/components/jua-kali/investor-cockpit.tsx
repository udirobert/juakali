import { useEffect, useMemo, useState } from "react";
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
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
    FadeIn,
    FadeInDown,
    FadeInUp,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withRepeat,
    withTiming,
} from "react-native-reanimated";
import { useMutation, useQuery } from "convex/react";
import type { Id } from "@/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";

import { api } from "@/convex/_generated/api";
import { color, font, layout, type } from "@/components/jua-kali/theme";

type Cockpit = FunctionReturnType<typeof api.invest.investorCockpit>;
type Commitment = Cockpit["commitments"][number];
type ToolResult = { tool: string; detail: string; status: "running" | "done" };
type AgentPhase = "idle" | "queued" | "acting" | "done";

function formatKes(value: number) {
    return `KES ${value.toLocaleString()}`;
}

function formatDigestDue(ts: number | null) {
    if (!ts) return "Not scheduled";
    return new Date(ts).toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function sourceLabel(source: string) {
    switch (source) {
        case "email_paste":
            return "email";
        case "sms":
            return "sms";
        case "manual":
            return "manual";
        default:
            return "agent";
    }
}

function Sparkline({ values }: { values: number[] }) {
    if (values.length === 0) {
        return <Text style={styles.sparkEmpty}>No trend yet</Text>;
    }
    const max = Math.max(...values, 1);
    return (
        <View style={styles.sparkRow}>
            {values.map((value, index) => (
                <View key={`${index}-${value}`} style={styles.sparkBarTrack}>
                    <View style={[styles.sparkBar, { height: Math.max(4, Math.round((value / max) * 36)) }]} />
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
        progress.value = withRepeat(withTiming(1, { duration: 1100 }), -1, true);
    }, [active, progress, reduceMotion]);

    const style = useAnimatedStyle(() => ({
        opacity: active ? 0.4 + progress.value * 0.5 : 0,
        transform: [{ translateX: (progress.value - 0.5) * 40 }],
    }));

    if (!active) return null;
    return (
        <View style={styles.shimmerTrack} accessibilityElementsHidden>
            <Animated.View style={[styles.shimmerBar, style]} />
        </View>
    );
}

function ElapsedActing({ phase }: { phase: AgentPhase }) {
    const [seconds, setSeconds] = useState(0);

    useEffect(() => {
        if (phase !== "acting") {
            setSeconds(0);
            return;
        }
        const started = Date.now();
        const id = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 250);
        return () => clearInterval(id);
    }, [phase]);

    if (phase !== "acting") return null;
    return <Text style={styles.elapsed}>Acting · {seconds}s</Text>;
}

export function InvestorCockpit() {
    const data = useQuery(api.invest.investorCockpit, {});
    const seedInvestDemo = useMutation(api.invest.seedInvestDemo);
    const pledgeCommitment = useMutation(api.invest.pledgeCommitment);
    const sendInvestorEmail = useMutation(api.invest.sendInvestorEmail);
    const insets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    const isCompact = width < 420;
    const padX = Math.max(16, Math.min(32, (width - layout.maxWidth) / 2 + 20));

    const [selectedCommitmentId, setSelectedCommitmentId] = useState<Id<"commitments"> | null>(null);
    const [selectedVentureId, setSelectedVentureId] = useState<Id<"ventures"> | null>(null);
    const [amountText, setAmountText] = useState("10000");
    const [emailDraft, setEmailDraft] = useState(
        "Please push follow-ups this week and reply with what moved. Keep it short."
    );
    const [pendingBody, setPendingBody] = useState<string | null>(null);
    const [agentPhase, setAgentPhase] = useState<AgentPhase>("idle");
    const [toolResults, setToolResults] = useState<ToolResult[]>([]);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [isSeeding, setIsSeeding] = useState(false);
    const [isPledging, setIsPledging] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [showPledge, setShowPledge] = useState(false);
    const [showThread, setShowThread] = useState(false);

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
        setStatusMessage("Queued — choose an approval path below.");
        void AccessibilityInfo.announceForAccessibility("Email queued. Awaiting your approval.");
    }

    function handleDiscardQueue() {
        setPendingBody(null);
        setAgentPhase("idle");
        setStatusMessage(null);
    }

    async function handleApproveEmail() {
        if (!pendingBody || !selectedCommitment) return;
        setIsSending(true);
        setAgentPhase("acting");
        setToolResults([
            { tool: "log_kpi", detail: "Inferring hard KPI…", status: "running" },
            { tool: "digest", detail: "Writing digest artifact…", status: "running" },
            { tool: "ledger", detail: "Publishing evidence…", status: "running" },
            { tool: "reply", detail: "Queuing agent reply…", status: "running" },
        ]);

        try {
            const result = await sendInvestorEmail({
                commitmentId: selectedCommitment.id,
                body: pendingBody,
            });
            await new Promise((resolve) => setTimeout(resolve, 420));
            setToolResults(
                result.toolResults.map((row) => ({
                    tool: row.tool.replace(/_/g, " "),
                    detail: row.detail,
                    status: "done" as const,
                }))
            );
            setPendingBody(null);
            setEmailDraft("");
            setAgentPhase("done");
            setStatusMessage(result.message);
            void AccessibilityInfo.announceForAccessibility("Agent finished. Digest and ledger updated.");
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
                <Text style={styles.loadingText}>Loading commitments…</Text>
            </View>
        );
    }

    return (
        <View style={[styles.screen, { paddingTop: insets.top }]}>
            <LinearGradient
                colors={["rgba(166,124,45,0.08)", "transparent", "rgba(20,24,22,0.03)"]}
                locations={[0, 0.35, 1]}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
            />
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
                <Animated.View entering={FadeIn.duration(320)} style={styles.hero}>
                    <Text style={type.eyebrow}>Invest in public</Text>
                    <Text accessibilityRole="header" style={[styles.brand, isCompact && styles.brandCompact]}>
                        JuaKali
                    </Text>
                    <Text style={styles.lead}>
                        Soft pledges. Hard KPIs. Agent digests on a public ledger — demo only, not securities.
                    </Text>
                    <View style={styles.heroActions}>
                        <Pressable
                            onPress={handleSeed}
                            disabled={isSeeding}
                            style={[styles.primaryButton, isSeeding && styles.disabled]}
                        >
                            <Text style={styles.primaryButtonText}>{isSeeding ? "Seeding…" : "Seed demo"}</Text>
                        </Pressable>
                        <Pressable onPress={() => setShowPledge((v) => !v)} style={styles.ghostButton}>
                            <Text style={styles.ghostButtonText}>{showPledge ? "Hide pledge" : "Soft pledge"}</Text>
                        </Pressable>
                    </View>
                    {statusMessage ? <Text style={styles.statusLine}>{statusMessage}</Text> : null}
                </Animated.View>

                <View style={styles.ritualRail}>
                    {[
                        { n: "01", label: "Queue" },
                        { n: "02", label: "Approve" },
                        { n: "03", label: "Artifacts" },
                    ].map((step, i) => (
                        <View key={step.n} style={styles.ritualItem}>
                            {i > 0 ? <Text style={styles.ritualDot}>·</Text> : null}
                            <Text style={styles.ritualN}>{step.n}</Text>
                            <Text style={styles.ritualLabel}>{step.label}</Text>
                        </View>
                    ))}
                </View>

                {showPledge ? (
                    <Animated.View entering={FadeInDown.duration(220)} style={styles.panel}>
                        <Text style={styles.panelTitle}>Soft pledge</Text>
                        <Text style={styles.panelHint}>Microcommitment for the demo — no live payment.</Text>
                        <View style={styles.chipRow}>
                            {data.availableVentures.map((venture) => (
                                <Pressable
                                    key={venture.id}
                                    onPress={() => setSelectedVentureId(venture.id)}
                                    style={[styles.chip, selectedVenture?.id === venture.id && styles.chipActive]}
                                >
                                    <Text
                                        style={[
                                            styles.chipText,
                                            selectedVenture?.id === venture.id && styles.chipTextActive,
                                        ]}
                                    >
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
                            placeholder="Amount KES"
                            placeholderTextColor={color.mist}
                        />
                        <Pressable
                            onPress={handlePledge}
                            disabled={isPledging || !selectedVenture}
                            style={[styles.primaryButton, (isPledging || !selectedVenture) && styles.disabled]}
                        >
                            <Text style={styles.primaryButtonText}>
                                {isPledging ? "Pledging…" : "Commit soft pledge"}
                            </Text>
                        </Pressable>
                    </Animated.View>
                ) : null}

                {data.commitments.length === 0 ? (
                    <View style={styles.panel}>
                        <Text style={styles.panelTitle}>No commitments yet</Text>
                        <Text style={styles.panelHint}>Seed the demo to open the investor walkthrough.</Text>
                    </View>
                ) : (
                    <>
                        <View style={styles.portfolioStrip}>
                            {data.commitments.map((row) => {
                                const active = selectedCommitment?.id === row.id;
                                return (
                                    <Pressable
                                        key={row.id}
                                        onPress={() => setSelectedCommitmentId(row.id)}
                                        style={[styles.portfolioChip, active && styles.portfolioChipActive]}
                                    >
                                        <Text style={[styles.portfolioName, active && styles.portfolioNameActive]}>
                                            {row.venture.name}
                                        </Text>
                                        <Text style={styles.portfolioAmount}>{formatKes(row.amountKes)}</Text>
                                    </Pressable>
                                );
                            })}
                        </View>

                        {selectedCommitment ? (
                            <View style={styles.stack}>
                                <Scorecard commitment={selectedCommitment} />
                                <EmailRitual
                                    commitment={selectedCommitment}
                                    draft={emailDraft}
                                    onChangeDraft={setEmailDraft}
                                    pendingBody={pendingBody}
                                    agentPhase={agentPhase}
                                    toolResults={toolResults}
                                    waiting={waiting}
                                    showThread={showThread}
                                    onToggleThread={() => setShowThread((v) => !v)}
                                    onQueue={handleQueueEmail}
                                    onApprove={handleApproveEmail}
                                    onDiscard={handleDiscardQueue}
                                    sending={isSending}
                                />
                            </View>
                        ) : null}
                    </>
                )}
            </ScrollView>
        </View>
    );
}

function Scorecard({ commitment }: { commitment: Commitment }) {
    const { venture } = commitment;
    const peer = venture.peerMedian;
    const latest = venture.kpiLatest;
    const vsPeer =
        peer == null
            ? null
            : latest === peer
              ? "in line with peers"
              : latest > peer
                ? "above peer median"
                : "below peer median";
    const progress =
        venture.kpiTarget > 0 ? Math.min(1, venture.kpiTotal / venture.kpiTarget) : 0;

    return (
        <Animated.View entering={FadeInUp.duration(280)} style={styles.scorecard}>
            <View style={styles.scoreHeader}>
                <View style={{ flex: 1, gap: 4 }}>
                    <Text style={styles.panelTitle}>{venture.name}</Text>
                    <Text style={styles.panelHint}>{venture.summary}</Text>
                </View>
                <Text style={styles.badge}>{commitment.digestCadence ?? "Weekly"}</Text>
            </View>

            <View style={styles.scoreMetrics}>
                <MetricCell value={venture.kpiTotal} label={`${venture.kpiLabel} total`} />
                <MetricCell value={venture.kpiTarget} label="Target" />
                <MetricCell value={peer ?? "—"} label="Peer median" />
            </View>

            <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
            </View>
            {vsPeer ? (
                <Text style={styles.peerLine}>
                    Latest {latest} · {vsPeer}
                </Text>
            ) : null}
            <Sparkline values={venture.sparkline} />
            <Text style={styles.channelLine}>
                Next digest · {formatDigestDue(commitment.nextDigestAt)} · {venture.agentEmail ?? "agent@…"}
            </Text>

            {commitment.latestDigest ? (
                <DigestArtifact digest={commitment.latestDigest} cadence={commitment.digestCadence} />
            ) : null}

            {commitment.recentCheckIns.length > 0 ? (
                <View style={styles.checkIns}>
                    {commitment.recentCheckIns.slice(0, 3).map((checkIn) => (
                        <Text key={checkIn.id} style={styles.checkInLine}>
                            <Text style={styles.sourceTag}>{sourceLabel(checkIn.source)}</Text> {checkIn.periodLabel}:{" "}
                            {checkIn.metric}={checkIn.value}
                            {checkIn.note ? ` — ${checkIn.note}` : ""}
                        </Text>
                    ))}
                </View>
            ) : null}
        </Animated.View>
    );
}

function MetricCell({ value, label }: { value: number | string; label: string }) {
    return (
        <View style={styles.scoreMetric}>
            <Text style={styles.scoreValue}>{value}</Text>
            <Text style={styles.scoreLabel}>{label}</Text>
        </View>
    );
}

function DigestArtifact({
    digest,
    cadence,
}: {
    digest: NonNullable<Commitment["latestDigest"]>;
    cadence: string | null;
}) {
    const nextMatch = digest.insights.match(/Next digest[^.]*\.?/i);
    const insightBody = nextMatch
        ? digest.insights.replace(nextMatch[0], "").trim() || digest.insights
        : digest.insights;
    const nextAction = nextMatch?.[0]?.trim() || (cadence ? `Next digest · ${cadence}` : null);

    return (
        <View style={styles.artifactCard}>
            <View style={styles.artifactHeader}>
                <Text style={styles.digestLabel}>Insight</Text>
                <Text style={styles.artifactStamp}>
                    {new Date(digest.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </Text>
            </View>
            <Text style={styles.artifactSummary}>{digest.summary}</Text>
            {insightBody ? <Text style={styles.artifactBody}>{insightBody}</Text> : null}
            {nextAction ? (
                <View style={styles.artifactSection}>
                    <Text style={styles.artifactSectionLabel}>Next</Text>
                    <Text style={styles.artifactBody}>{nextAction}</Text>
                </View>
            ) : null}
            <View style={styles.evidenceRow}>
                <Text style={styles.sourceTag}>evidence</Text>
                <Text style={styles.evidenceText}>Public ledger · email ritual</Text>
            </View>
        </View>
    );
}

function EmailRitual({
    commitment,
    draft,
    onChangeDraft,
    pendingBody,
    agentPhase,
    toolResults,
    waiting,
    showThread,
    onToggleThread,
    onQueue,
    onApprove,
    onDiscard,
    sending,
}: {
    commitment: Commitment;
    draft: string;
    onChangeDraft: (value: string) => void;
    pendingBody: string | null;
    agentPhase: AgentPhase;
    toolResults: ToolResult[];
    waiting: boolean;
    showThread: boolean;
    onToggleThread: () => void;
    onQueue: () => void;
    onApprove: () => void;
    onDiscard: () => void;
    sending: boolean;
}) {
    const emails = commitment.recentEmails;
    const visibleEmails = showThread ? emails : emails.slice(0, 1);

    return (
        <View style={styles.emailPanel}>
            <View style={styles.scoreHeader}>
                <Text style={styles.panelTitle}>Email ritual</Text>
                <AgentStatusChip phase={agentPhase} />
            </View>
            <Text style={styles.panelHint}>Composer stays short. Digests live as insight cards above.</Text>

            <WaitingShimmer active={waiting} />
            <View style={styles.statusChipRow}>
                <PhaseChip label="Queued" active={agentPhase === "queued"} />
                <PhaseChip label="Acting" active={agentPhase === "acting"} />
                <PhaseChip label="Done" active={agentPhase === "done"} />
                <ElapsedActing phase={agentPhase} />
            </View>

            {toolResults.length > 0 ? (
                <View style={styles.toolChipRow}>
                    {toolResults.map((result, index) => (
                        <ToolChip key={`${result.tool}-${index}`} result={result} index={index} />
                    ))}
                </View>
            ) : null}

            {pendingBody ? (
                <Animated.View entering={FadeInDown.duration(200)} style={styles.approvalCard}>
                    <Text style={styles.digestLabel}>Before the agent acts</Text>
                    <Text style={styles.approvalHint}>
                        KPI (if present) → digest artifact → public ledger → reply.
                    </Text>
                    <Text style={styles.emailBody}>{pendingBody}</Text>
                    <View style={styles.approvalChoices}>
                        <Pressable
                            onPress={onApprove}
                            disabled={sending}
                            style={[styles.choicePrimary, sending && styles.disabled]}
                        >
                            <Text style={styles.choicePrimaryText}>
                                {sending ? "Acting…" : "Approve · run tools"}
                            </Text>
                        </Pressable>
                        <Pressable onPress={onDiscard} style={styles.choiceSecondary}>
                            <Text style={styles.choiceSecondaryText}>Discard</Text>
                        </Pressable>
                    </View>
                </Animated.View>
            ) : (
                <>
                    <TextInput
                        value={draft}
                        onChangeText={onChangeDraft}
                        multiline
                        style={[styles.input, styles.emailInput]}
                        placeholder="Short note to the agent…"
                        placeholderTextColor={color.mist}
                        maxLength={480}
                    />
                    <Pressable onPress={onQueue} style={styles.primaryButton}>
                        <Text style={styles.primaryButtonText}>Queue for agent</Text>
                    </Pressable>
                </>
            )}

            {emails.length > 0 ? (
                <View style={styles.thread}>
                    <Pressable onPress={onToggleThread}>
                        <Text style={styles.threadToggleText}>
                            {showThread
                                ? "Hide thread"
                                : `Thread · ${emails.length} message${emails.length === 1 ? "" : "s"}`}
                        </Text>
                    </Pressable>
                    {visibleEmails.map((email) => (
                        <View
                            key={email.id}
                            style={[
                                styles.emailBubble,
                                email.direction === "inbound" ? styles.emailInbound : styles.emailOutbound,
                            ]}
                        >
                            <Text style={styles.emailMeta}>
                                {email.direction === "inbound" ? "You" : "Agent"} · {email.fromAddress}
                            </Text>
                            <Text style={styles.emailSubject}>{email.subject}</Text>
                            <Text style={styles.emailBody} numberOfLines={showThread ? undefined : 3}>
                                {email.body}
                            </Text>
                        </View>
                    ))}
                </View>
            ) : (
                <Text style={styles.panelHint}>No messages yet — queue the first note above.</Text>
            )}
        </View>
    );
}

function ToolChip({ result, index }: { result: ToolResult; index: number }) {
    const running = result.status === "running";
    return (
        <Animated.View
            entering={FadeInUp.delay(index * 35).duration(200)}
            style={[styles.toolChip, running && styles.toolChipRunning]}
        >
            {running ? (
                <ActivityIndicator size="small" color={color.brass} />
            ) : (
                <Text style={styles.toolCheck}>✓</Text>
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.toolName} numberOfLines={1}>
                    {result.tool}
                </Text>
                <Text style={styles.toolDetail} numberOfLines={2}>
                    {result.detail}
                </Text>
            </View>
        </Animated.View>
    );
}

function AgentStatusChip({ phase }: { phase: AgentPhase }) {
    const label =
        phase === "queued"
            ? "Awaiting approval"
            : phase === "acting"
              ? "Agent acting"
              : phase === "done"
                ? "Complete"
                : "Ready";
    return <Text style={styles.badge}>{label}</Text>;
}

function PhaseChip({ label, active }: { label: string; active: boolean }) {
    return (
        <View style={[styles.phaseChip, active && styles.phaseChipActive]}>
            <Text style={[styles.phaseChipText, active && styles.phaseChipTextActive]}>{label}</Text>
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
    loadingText: { ...type.meta, color: color.mist },
    content: { gap: 20, paddingTop: 12 },
    hero: { gap: 10, alignItems: "center", paddingTop: 8 },
    brand: { ...type.brand, textAlign: "center" },
    brandCompact: { fontSize: 34 },
    lead: {
        ...type.body,
        textAlign: "center",
        color: color.mist,
        maxWidth: 480,
    },
    heroActions: { flexDirection: "row", gap: 10, flexWrap: "wrap", justifyContent: "center", marginTop: 6 },
    primaryButton: {
        backgroundColor: color.charcoal,
        paddingHorizontal: 18,
        paddingVertical: 12,
        borderRadius: 4,
        minHeight: 44,
        justifyContent: "center",
    },
    primaryButtonText: {
        fontFamily: font.bodyBold,
        color: color.paper,
        fontWeight: "700",
        fontSize: 13,
        letterSpacing: 0.2,
    },
    ghostButton: {
        borderWidth: 1,
        borderColor: color.lineStrong,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 4,
        minHeight: 44,
        justifyContent: "center",
        backgroundColor: color.paper,
    },
    ghostButtonText: {
        fontFamily: font.bodyBold,
        color: color.charcoal,
        fontWeight: "700",
        fontSize: 13,
    },
    disabled: { opacity: 0.5 },
    statusLine: { ...type.meta, color: color.brass, textAlign: "center", marginTop: 4 },
    ritualRail: {
        flexDirection: "row",
        justifyContent: "center",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 6,
        paddingVertical: 4,
    },
    ritualItem: { flexDirection: "row", alignItems: "center", gap: 6 },
    ritualDot: { color: color.mist, marginHorizontal: 4 },
    ritualN: { fontFamily: font.bodyBold, color: color.brass, fontSize: 11, fontWeight: "700" },
    ritualLabel: { fontFamily: font.bodyMedium, color: color.charcoal, fontSize: 13, fontWeight: "500" },
    panel: {
        gap: 12,
        padding: 18,
        backgroundColor: color.paper,
        borderWidth: 1,
        borderColor: color.line,
        borderRadius: 6,
    },
    panelTitle: { ...type.title, fontSize: 22 },
    panelHint: { ...type.meta, lineHeight: 18 },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 4,
        backgroundColor: "rgba(20,24,22,0.05)",
        minHeight: 40,
        justifyContent: "center",
    },
    chipActive: { backgroundColor: color.brassSoft, borderWidth: 1, borderColor: color.brass },
    chipText: { fontFamily: font.bodyMedium, color: color.ink, fontWeight: "500", fontSize: 13 },
    chipTextActive: { color: color.charcoal, fontWeight: "700" },
    input: {
        borderWidth: 1,
        borderColor: color.lineStrong,
        borderRadius: 4,
        paddingHorizontal: 14,
        paddingVertical: 12,
        color: color.ink,
        backgroundColor: color.stone,
        fontFamily: font.body,
        fontSize: 15,
    },
    portfolioStrip: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" },
    portfolioChip: {
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 4,
        backgroundColor: color.paper,
        borderWidth: 1,
        borderColor: color.line,
        gap: 2,
        minWidth: 140,
    },
    portfolioChipActive: { borderColor: color.brass, backgroundColor: color.brassSoft },
    portfolioName: { fontFamily: font.bodyBold, color: color.ink, fontSize: 13, fontWeight: "700" },
    portfolioNameActive: { color: color.charcoal },
    portfolioAmount: { fontFamily: font.body, color: color.brass, fontSize: 12, fontWeight: "600" },
    stack: { gap: 14 },
    scorecard: {
        gap: 12,
        padding: 20,
        backgroundColor: color.paper,
        borderWidth: 1,
        borderColor: color.line,
        borderRadius: 6,
    },
    scoreHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
    badge: {
        fontFamily: font.bodyBold,
        color: color.brass,
        fontSize: 10,
        fontWeight: "700",
        letterSpacing: 0.8,
        textTransform: "uppercase",
    },
    scoreMetrics: { flexDirection: "row", gap: 10 },
    scoreMetric: {
        flex: 1,
        padding: 12,
        borderRadius: 4,
        backgroundColor: color.stone,
        gap: 4,
    },
    scoreValue: {
        fontFamily: font.display,
        color: color.charcoal,
        fontSize: 24,
        fontWeight: "700",
        letterSpacing: -0.5,
    },
    scoreLabel: {
        fontFamily: font.bodyBold,
        color: color.mist,
        fontSize: 10,
        fontWeight: "700",
        textTransform: "uppercase",
        letterSpacing: 0.6,
    },
    progressTrack: {
        height: 4,
        borderRadius: 2,
        backgroundColor: "rgba(20,24,22,0.08)",
        overflow: "hidden",
    },
    progressFill: { height: "100%", backgroundColor: color.brass },
    peerLine: { fontFamily: font.bodyMedium, color: color.mist, fontSize: 13, fontWeight: "500" },
    sparkRow: { flexDirection: "row", alignItems: "flex-end", gap: 5, height: 40 },
    sparkBarTrack: {
        flex: 1,
        height: 40,
        justifyContent: "flex-end",
        backgroundColor: "rgba(20,24,22,0.05)",
        borderRadius: 2,
        overflow: "hidden",
    },
    sparkBar: { width: "100%", backgroundColor: color.charcoal, borderRadius: 2 },
    sparkEmpty: { ...type.meta },
    channelLine: { ...type.meta },
    artifactCard: {
        gap: 8,
        padding: 14,
        borderRadius: 4,
        backgroundColor: color.brassSoft,
        borderWidth: 1,
        borderColor: "rgba(166,124,45,0.28)",
    },
    artifactHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    artifactStamp: { ...type.meta },
    artifactSummary: {
        fontFamily: font.displayMedium,
        color: color.charcoal,
        fontSize: 17,
        fontWeight: "600",
        lineHeight: 24,
    },
    artifactSection: { gap: 2 },
    artifactSectionLabel: {
        fontFamily: font.bodyBold,
        color: color.brass,
        fontSize: 10,
        fontWeight: "700",
        letterSpacing: 0.6,
        textTransform: "uppercase",
    },
    artifactBody: { fontFamily: font.body, color: color.ink, fontSize: 13, lineHeight: 19 },
    evidenceRow: { flexDirection: "row", gap: 8, alignItems: "center" },
    evidenceText: { flex: 1, ...type.meta },
    digestLabel: {
        fontFamily: font.bodyBold,
        color: color.brass,
        fontSize: 10,
        fontWeight: "700",
        letterSpacing: 0.8,
        textTransform: "uppercase",
    },
    checkIns: { gap: 4 },
    checkInLine: { fontFamily: font.body, color: color.mist, fontSize: 12, lineHeight: 17 },
    sourceTag: {
        fontFamily: font.bodyBold,
        color: color.brass,
        fontWeight: "700",
        textTransform: "uppercase",
        fontSize: 10,
    },
    emailPanel: {
        gap: 10,
        padding: 20,
        backgroundColor: color.paper,
        borderWidth: 1,
        borderColor: color.line,
        borderRadius: 6,
    },
    shimmerTrack: {
        height: 2,
        borderRadius: 99,
        overflow: "hidden",
        backgroundColor: "rgba(166,124,45,0.12)",
    },
    shimmerBar: {
        width: "36%",
        height: "100%",
        borderRadius: 99,
        backgroundColor: color.brass,
    },
    statusChipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
    phaseChip: {
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 3,
        backgroundColor: "rgba(20,24,22,0.05)",
    },
    phaseChipActive: { backgroundColor: color.brassSoft },
    phaseChipText: { fontFamily: font.bodyBold, color: color.mist, fontSize: 11, fontWeight: "700" },
    phaseChipTextActive: { color: color.charcoal },
    elapsed: { fontFamily: font.bodyBold, color: color.brass, fontSize: 11, fontWeight: "700", marginLeft: 4 },
    toolChipRow: { gap: 6 },
    toolChip: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
        padding: 10,
        borderRadius: 4,
        backgroundColor: color.stone,
    },
    toolChipRunning: {
        backgroundColor: color.brassSoft,
        borderWidth: 1,
        borderColor: "rgba(166,124,45,0.25)",
    },
    toolCheck: { fontFamily: font.bodyBold, color: color.success, fontSize: 14, fontWeight: "700", width: 16 },
    toolName: {
        fontFamily: font.bodyBold,
        color: color.charcoal,
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 0.3,
        textTransform: "uppercase",
    },
    toolDetail: { fontFamily: font.body, color: color.mist, fontSize: 12, lineHeight: 16 },
    thread: { gap: 8 },
    threadToggleText: { fontFamily: font.bodyBold, color: color.brass, fontSize: 12, fontWeight: "700" },
    emailBubble: { gap: 3, padding: 12, borderRadius: 4 },
    emailInbound: { backgroundColor: color.stone },
    emailOutbound: { backgroundColor: color.brassSoft },
    emailMeta: { ...type.meta, fontSize: 10 },
    emailSubject: { fontFamily: font.bodyBold, color: color.charcoal, fontSize: 12, fontWeight: "700" },
    emailBody: { fontFamily: font.body, color: color.ink, fontSize: 13, lineHeight: 18 },
    emailInput: { minHeight: 72, maxHeight: 120, textAlignVertical: "top" },
    approvalCard: {
        gap: 10,
        padding: 14,
        borderRadius: 4,
        backgroundColor: color.brassSoft,
        borderWidth: 1,
        borderColor: "rgba(166,124,45,0.35)",
    },
    approvalHint: { ...type.meta, lineHeight: 17 },
    approvalChoices: { gap: 8 },
    choicePrimary: {
        backgroundColor: color.charcoal,
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderRadius: 4,
        alignItems: "center",
    },
    choicePrimaryText: {
        fontFamily: font.bodyBold,
        color: color.paper,
        fontWeight: "700",
        fontSize: 14,
    },
    choiceSecondary: {
        paddingVertical: 12,
        alignItems: "center",
        borderWidth: 1,
        borderColor: color.lineStrong,
        borderRadius: 4,
        backgroundColor: color.paper,
    },
    choiceSecondaryText: {
        fontFamily: font.bodyBold,
        color: color.charcoal,
        fontWeight: "700",
        fontSize: 13,
    },
});
