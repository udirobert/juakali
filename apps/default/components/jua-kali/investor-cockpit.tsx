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

type Cockpit = FunctionReturnType<typeof api.invest.investorCockpit>;
type Commitment = Cockpit["commitments"][number];
type ToolResult = { tool: string; detail: string; status: "running" | "done" };
type AgentPhase = "idle" | "queued" | "acting" | "done";

const palette = {
    terracotta: "#E07A5F",
    cream: "#F5F1E8",
    olive: "#3B4D3B",
    ink: "#243124",
    moss: "#71845F",
};

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
                    <View style={[styles.sparkBar, { height: Math.max(4, Math.round((value / max) * 32)) }]} />
                </View>
            ))}
        </View>
    );
}

/** One shimmer = one waiting state. Idle surfaces stay still. */
function WaitingShimmer({ active }: { active: boolean }) {
    const reduceMotion = useReducedMotion();
    const progress = useSharedValue(0);

    useEffect(() => {
        if (!active || reduceMotion) {
            progress.value = 0;
            return;
        }
        progress.value = withRepeat(withTiming(1, { duration: 1200 }), -1, true);
    }, [active, progress, reduceMotion]);

    const style = useAnimatedStyle(() => ({
        opacity: active ? 0.35 + progress.value * 0.45 : 0,
        transform: [{ translateX: (progress.value - 0.5) * 24 }],
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
        const id = setInterval(() => {
            setSeconds(Math.floor((Date.now() - started) / 1000));
        }, 250);
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
    const isWide = width >= 960;
    const isCompact = width < 420;

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
            const result = await pledgeCommitment({
                ventureId: selectedVenture.id,
                amountKes,
            });
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
        setStatusMessage("Queued — approve to run agent tools.");
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
        const runningTools: ToolResult[] = [
            { tool: "log_kpi_check_in", detail: "Inferring hard KPI from note…", status: "running" },
            { tool: "create_digest", detail: "Writing investor digest…", status: "running" },
            { tool: "ledger_event", detail: "Publishing evidence to ledger…", status: "running" },
            { tool: "send_reply", detail: "Queuing agent reply…", status: "running" },
        ];
        setToolResults(runningTools);

        try {
            const result = await sendInvestorEmail({
                commitmentId: selectedCommitment.id,
                body: pendingBody,
            });
            // Brief beat so spinner→check reads as a state change, not a flash.
            await new Promise((resolve) => setTimeout(resolve, 420));
            setToolResults(
                result.toolResults.map((row) => ({
                    tool: row.tool,
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
                <ActivityIndicator color={palette.olive} />
                <Text style={styles.loadingText}>Loading cockpit…</Text>
            </View>
        );
    }

    return (
        <View style={[styles.screen, { paddingTop: insets.top }]}>
            <ScrollView
                contentContainerStyle={[
                    styles.content,
                    {
                        paddingHorizontal: isCompact ? 14 : 20,
                        paddingBottom: Math.max(insets.bottom, 24) + 72,
                    },
                ]}
                showsVerticalScrollIndicator={false}
            >
                <View style={[styles.topBar, isCompact && styles.topBarCompact]}>
                    <View style={{ flex: 1, gap: 4 }}>
                        <Text style={styles.eyebrow}>Juakali · Invest in public</Text>
                        <Text style={[styles.title, isCompact && styles.titleCompact]}>Your commitments</Text>
                        <Text style={styles.subtitle}>
                            Soft pledges, hard KPIs, agent digests. Artifacts first — chat stays short.
                        </Text>
                    </View>
                    <View style={styles.topActions}>
                        <Pressable
                            onPress={() => setShowPledge((v) => !v)}
                            style={styles.ghostButton}
                            accessibilityRole="button"
                        >
                            <Text style={styles.ghostButtonText}>{showPledge ? "Hide" : "Pledge"}</Text>
                        </Pressable>
                        <Pressable
                            onPress={handleSeed}
                            disabled={isSeeding}
                            style={[styles.primaryButton, isSeeding && styles.disabled]}
                            accessibilityRole="button"
                        >
                            <Text style={styles.primaryButtonText}>{isSeeding ? "Seeding…" : "Seed demo"}</Text>
                        </Pressable>
                    </View>
                </View>

                {statusMessage ? <Text style={styles.statusLine}>{statusMessage}</Text> : null}

                <View style={styles.ritualStrip}>
                    <RitualStep n="01" label="Queue" detail="Compose a short note" />
                    <Text style={styles.ritualArrow}>→</Text>
                    <RitualStep n="02" label="Approve" detail="You stay in control" />
                    <Text style={styles.ritualArrow}>→</Text>
                    <RitualStep n="03" label="Artifacts" detail="KPI · digest · ledger" />
                </View>

                {showPledge ? (
                    <Animated.View entering={FadeInDown.duration(220)} style={styles.panel}>
                        <Text style={styles.panelTitle}>Soft pledge</Text>
                        <Text style={styles.panelHint}>Demo microcommitment — not a live payment.</Text>
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
                            placeholderTextColor="rgba(36,49,36,0.35)"
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
                        <Text style={styles.panelHint}>Seed the demo or add a soft pledge to open the cockpit.</Text>
                    </View>
                ) : (
                    <View style={[styles.mainGrid, isWide && styles.mainGridWide]}>
                        <View style={[styles.panel, { flex: 1 }]}>
                            <Text style={styles.panelTitle}>Portfolio</Text>
                            {data.commitments.map((row) => {
                                const active = selectedCommitment?.id === row.id;
                                const progress =
                                    row.venture.kpiTarget > 0
                                        ? Math.min(1, row.venture.kpiTotal / row.venture.kpiTarget)
                                        : 0;
                                return (
                                    <Pressable
                                        key={row.id}
                                        onPress={() => setSelectedCommitmentId(row.id)}
                                        style={[styles.commitmentRow, active && styles.commitmentRowActive]}
                                    >
                                        <View style={styles.commitmentTop}>
                                            <Text style={styles.commitmentName}>{row.venture.name}</Text>
                                            <Text style={styles.commitmentAmount}>{formatKes(row.amountKes)}</Text>
                                        </View>
                                        <Text style={styles.metaLine}>
                                            Next digest · {formatDigestDue(row.nextDigestAt)}
                                        </Text>
                                        <View style={styles.progressTrack}>
                                            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
                                        </View>
                                    </Pressable>
                                );
                            })}
                        </View>

                        {selectedCommitment ? (
                            <View style={[styles.panel, { flex: 1.4, gap: 14 }]}>
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
                    </View>
                )}
            </ScrollView>
        </View>
    );
}

function RitualStep({ n, label, detail }: { n: string; label: string; detail: string }) {
    return (
        <View style={styles.ritualStep}>
            <Text style={styles.ritualN}>{n}</Text>
            <Text style={styles.ritualLabel}>{label}</Text>
            <Text style={styles.ritualDetail}>{detail}</Text>
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

    return (
        <View style={styles.scorecard}>
            <View style={styles.scoreHeader}>
                <Text style={styles.panelTitle}>{venture.name}</Text>
                <Text style={styles.badge}>{commitment.digestCadence ?? "Weekly digest"}</Text>
            </View>
            <Text style={styles.panelHint}>{venture.summary}</Text>
            <View style={styles.scoreMetrics}>
                <MetricCell value={venture.kpiTotal} label={`${venture.kpiLabel} total`} />
                <MetricCell value={venture.kpiTarget} label="Target" />
                <MetricCell value={peer ?? "—"} label="Peer median" />
            </View>
            {vsPeer ? (
                <Text style={styles.peerLine}>
                    Latest {latest} · {vsPeer}
                </Text>
            ) : null}
            <Sparkline values={venture.sparkline} />
            <Text style={styles.channelLine}>
                Channels · Email {venture.agentEmail ?? "agent@…"} · SMS · Ledger
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
        </View>
    );
}

function MetricCell({ value, label }: { value: number | string; label: string }) {
    return (
        <Animated.View entering={FadeIn.duration(280)} style={styles.scoreMetric}>
            <Text style={styles.scoreValue}>{value}</Text>
            <Text style={styles.scoreLabel}>{label}</Text>
        </Animated.View>
    );
}

/** Artifact card — primary surface for digest, not a chat wall. */
function DigestArtifact({
    digest,
    cadence,
}: {
    digest: NonNullable<Commitment["latestDigest"]>;
    cadence: string | null;
}) {
    const nextMatch = digest.insights.match(/Next digest[^.]*\.?/i);
    const insightBody = nextMatch
        ? digest.insights.replace(nextMatch[0], "").trim().replace(/\s+$/, "") || digest.insights
        : digest.insights;
    const nextAction = nextMatch?.[0]?.trim() || (cadence ? `Next digest · ${cadence}` : null);

    return (
        <Animated.View entering={FadeInUp.duration(260)} style={styles.artifactCard}>
            <View style={styles.artifactHeader}>
                <Text style={styles.digestLabel}>Digest artifact</Text>
                <Text style={styles.artifactStamp}>
                    {new Date(digest.createdAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                    })}
                </Text>
            </View>
            <Text style={styles.artifactSummary}>{digest.summary}</Text>
            {insightBody ? (
                <View style={styles.artifactSection}>
                    <Text style={styles.artifactSectionLabel}>Insight</Text>
                    <Text style={styles.artifactBody}>{insightBody}</Text>
                </View>
            ) : null}
            {nextAction ? (
                <View style={styles.artifactSection}>
                    <Text style={styles.artifactSectionLabel}>Next</Text>
                    <Text style={styles.artifactBody}>{nextAction}</Text>
                </View>
            ) : null}
            <View style={styles.evidenceRow}>
                <Text style={styles.sourceTag}>evidence</Text>
                <Text style={styles.evidenceText}>Logged to public ledger · email ritual</Text>
            </View>
        </Animated.View>
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
            <Text style={styles.panelHint}>
                Queue → approve → tools. Composer stays short; digests live as cards above.
            </Text>

            <WaitingShimmer active={waiting} />

            <View style={styles.statusChipRow}>
                <PhaseChip label="Queued" active={agentPhase === "queued"} />
                <PhaseChip label="Acting" active={agentPhase === "acting"} />
                <PhaseChip label="Done" active={agentPhase === "done"} />
                <ElapsedActing phase={agentPhase} />
            </View>

            {toolResults.length > 0 ? (
                <View style={styles.toolResults}>
                    <Text style={styles.digestLabel}>Agent tools</Text>
                    {toolResults.map((result, index) => (
                        <ToolResultCard key={`${result.tool}-${index}`} result={result} index={index} />
                    ))}
                </View>
            ) : null}

            {pendingBody ? (
                <Animated.View entering={FadeInDown.duration(200)} style={styles.approvalCard}>
                    <Text style={styles.digestLabel}>Awaiting your approval</Text>
                    <Text style={styles.approvalHint}>
                        Agent will log KPI (if present), write a digest artifact, update the ledger, then reply.
                    </Text>
                    <Text style={styles.emailBody}>{pendingBody}</Text>
                    <View style={styles.approvalActions}>
                        <Pressable onPress={onDiscard} style={styles.ghostButton} accessibilityRole="button">
                            <Text style={styles.ghostButtonText}>Discard</Text>
                        </Pressable>
                        <Pressable
                            onPress={onApprove}
                            disabled={sending}
                            style={[styles.primaryButton, sending && styles.disabled]}
                            accessibilityRole="button"
                            accessibilityLabel="Approve send and run agent tools"
                        >
                            <Text style={styles.primaryButtonText}>
                                {sending ? "Acting…" : "Approve send"}
                            </Text>
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
                        placeholderTextColor="rgba(36,49,36,0.35)"
                        maxLength={480}
                    />
                    <Pressable onPress={onQueue} style={styles.primaryButton} accessibilityRole="button">
                        <Text style={styles.primaryButtonText}>Queue for agent</Text>
                    </Pressable>
                </>
            )}

            {emails.length > 0 ? (
                <View style={styles.thread}>
                    <Pressable onPress={onToggleThread} style={styles.threadToggle}>
                        <Text style={styles.threadToggleText}>
                            {showThread ? "Hide thread" : `Thread · ${emails.length} message${emails.length === 1 ? "" : "s"}`}
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

function ToolResultCard({ result, index }: { result: ToolResult; index: number }) {
    const running = result.status === "running";
    return (
        <Animated.View
            entering={FadeInUp.delay(index * 40).duration(220)}
            style={[styles.toolCard, running && styles.toolCardRunning]}
        >
            <View style={styles.toolTop}>
                {running ? (
                    <ActivityIndicator size="small" color={palette.terracotta} />
                ) : (
                    <Text style={styles.toolCheck}>✓</Text>
                )}
                <Text style={styles.toolName}>{result.tool}</Text>
            </View>
            <Text style={styles.toolDetail}>{result.detail}</Text>
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
    screen: { flex: 1, backgroundColor: palette.cream },
    loadingScreen: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        backgroundColor: palette.cream,
    },
    loadingText: { color: palette.ink, opacity: 0.7 },
    content: { gap: 14 },
    topBar: { flexDirection: "row", gap: 16, alignItems: "flex-start", flexWrap: "wrap" },
    topBarCompact: { gap: 10 },
    eyebrow: {
        color: palette.terracotta,
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 1.2,
        textTransform: "uppercase",
    },
    title: { color: palette.olive, fontSize: 28, fontWeight: "800", letterSpacing: -0.8 },
    titleCompact: { fontSize: 22 },
    subtitle: { color: "rgba(36,49,36,0.72)", fontSize: 13, lineHeight: 19, maxWidth: 520 },
    topActions: { flexDirection: "row", gap: 8, alignItems: "center" },
    ghostButton: {
        borderWidth: 1,
        borderColor: "rgba(59,77,59,0.25)",
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 14,
        minHeight: 44,
        justifyContent: "center",
    },
    ghostButtonText: { color: palette.olive, fontWeight: "700", fontSize: 13 },
    primaryButton: {
        alignSelf: "flex-start",
        backgroundColor: palette.terracotta,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 14,
        minHeight: 44,
        justifyContent: "center",
    },
    primaryButtonText: { color: palette.cream, fontWeight: "700", fontSize: 13 },
    disabled: { opacity: 0.55 },
    statusLine: { color: palette.moss, fontSize: 13 },
    ritualStrip: {
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 8,
        padding: 12,
        borderRadius: 16,
        backgroundColor: "rgba(59,77,59,0.06)",
        borderWidth: 1,
        borderColor: "rgba(59,77,59,0.1)",
    },
    ritualStep: { minWidth: 96, gap: 2, flexGrow: 1 },
    ritualN: { color: palette.terracotta, fontSize: 11, fontWeight: "800" },
    ritualLabel: { color: palette.olive, fontSize: 13, fontWeight: "800" },
    ritualDetail: { color: "rgba(36,49,36,0.65)", fontSize: 11 },
    ritualArrow: { color: "rgba(36,49,36,0.35)", fontWeight: "700", paddingHorizontal: 4 },
    mainGrid: { gap: 12 },
    mainGridWide: { flexDirection: "row", alignItems: "flex-start" },
    panel: {
        gap: 10,
        padding: 14,
        backgroundColor: "rgba(255,253,247,0.9)",
        borderWidth: 1,
        borderColor: "rgba(59,77,59,0.12)",
        borderRadius: 18,
    },
    panelTitle: { color: palette.olive, fontSize: 17, fontWeight: "800" },
    panelHint: { color: "rgba(36,49,36,0.65)", fontSize: 12, lineHeight: 17 },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: {
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 12,
        backgroundColor: "rgba(156,175,136,0.18)",
        minHeight: 40,
        justifyContent: "center",
    },
    chipActive: { backgroundColor: "rgba(224,122,95,0.2)" },
    chipText: { color: palette.olive, fontWeight: "700", fontSize: 12 },
    chipTextActive: { color: palette.ink },
    input: {
        borderWidth: 1,
        borderColor: "rgba(59,77,59,0.2)",
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
        color: palette.ink,
        backgroundColor: "rgba(245,241,232,0.95)",
        fontSize: 14,
        fontWeight: "600",
    },
    commitmentRow: {
        gap: 6,
        paddingVertical: 10,
        borderTopWidth: 1,
        borderTopColor: "rgba(59,77,59,0.08)",
    },
    commitmentRowActive: {
        backgroundColor: "rgba(224,122,95,0.08)",
        marginHorizontal: -6,
        paddingHorizontal: 6,
        borderRadius: 12,
    },
    commitmentTop: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
    commitmentName: { flex: 1, color: palette.olive, fontWeight: "800", fontSize: 14 },
    commitmentAmount: { color: palette.terracotta, fontWeight: "800", fontSize: 13 },
    metaLine: { color: "rgba(36,49,36,0.65)", fontSize: 11 },
    progressTrack: {
        height: 6,
        borderRadius: 99,
        backgroundColor: "rgba(59,77,59,0.1)",
        overflow: "hidden",
    },
    progressFill: { height: "100%", backgroundColor: palette.olive },
    scorecard: { gap: 8 },
    scoreHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
    badge: {
        color: palette.terracotta,
        fontSize: 10,
        fontWeight: "800",
        letterSpacing: 0.4,
        textTransform: "uppercase",
    },
    scoreMetrics: { flexDirection: "row", gap: 10 },
    scoreMetric: {
        flex: 1,
        padding: 10,
        borderRadius: 12,
        backgroundColor: "rgba(59,77,59,0.05)",
        gap: 2,
    },
    scoreValue: { color: palette.olive, fontSize: 20, fontWeight: "800" },
    scoreLabel: { color: "rgba(36,49,36,0.6)", fontSize: 10, fontWeight: "600", textTransform: "uppercase" },
    peerLine: { color: palette.moss, fontSize: 12, fontWeight: "600" },
    sparkRow: { flexDirection: "row", alignItems: "flex-end", gap: 6, height: 36 },
    sparkBarTrack: {
        flex: 1,
        height: 36,
        justifyContent: "flex-end",
        backgroundColor: "rgba(59,77,59,0.06)",
        borderRadius: 4,
        overflow: "hidden",
    },
    sparkBar: { width: "100%", backgroundColor: palette.olive, borderRadius: 4 },
    sparkEmpty: { color: "rgba(36,49,36,0.45)", fontSize: 11 },
    channelLine: { color: "rgba(36,49,36,0.55)", fontSize: 11 },
    artifactCard: {
        gap: 8,
        padding: 12,
        borderRadius: 14,
        backgroundColor: "rgba(156,175,136,0.16)",
        borderWidth: 1,
        borderColor: "rgba(59,77,59,0.14)",
    },
    artifactHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    artifactStamp: { color: "rgba(36,49,36,0.5)", fontSize: 11, fontWeight: "600" },
    artifactSummary: { color: palette.ink, fontSize: 15, fontWeight: "700", lineHeight: 21 },
    artifactSection: { gap: 2 },
    artifactSectionLabel: {
        color: palette.terracotta,
        fontSize: 10,
        fontWeight: "800",
        letterSpacing: 0.5,
        textTransform: "uppercase",
    },
    artifactBody: { color: "rgba(36,49,36,0.78)", fontSize: 13, lineHeight: 18 },
    evidenceRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
    evidenceText: { flex: 1, color: "rgba(36,49,36,0.7)", fontSize: 12, lineHeight: 16 },
    digestLabel: {
        color: palette.terracotta,
        fontSize: 10,
        fontWeight: "800",
        letterSpacing: 0.6,
        textTransform: "uppercase",
    },
    checkIns: { gap: 4 },
    checkInLine: { color: "rgba(36,49,36,0.7)", fontSize: 11, lineHeight: 16 },
    sourceTag: {
        color: palette.terracotta,
        fontWeight: "800",
        textTransform: "uppercase",
        fontSize: 10,
    },
    emailPanel: { gap: 8, borderTopWidth: 1, borderTopColor: "rgba(59,77,59,0.1)", paddingTop: 12 },
    shimmerTrack: {
        height: 3,
        borderRadius: 99,
        overflow: "hidden",
        backgroundColor: "rgba(224,122,95,0.12)",
    },
    shimmerBar: {
        width: "40%",
        height: "100%",
        borderRadius: 99,
        backgroundColor: palette.terracotta,
    },
    statusChipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
    phaseChip: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        backgroundColor: "rgba(59,77,59,0.08)",
    },
    phaseChipActive: { backgroundColor: "rgba(224,122,95,0.2)" },
    phaseChipText: { color: "rgba(36,49,36,0.55)", fontSize: 11, fontWeight: "700" },
    phaseChipTextActive: { color: palette.ink },
    elapsed: { color: palette.moss, fontSize: 11, fontWeight: "700", marginLeft: 4 },
    thread: { gap: 8 },
    threadToggle: { paddingVertical: 4 },
    threadToggleText: { color: palette.moss, fontSize: 12, fontWeight: "700" },
    emailBubble: { gap: 3, padding: 10, borderRadius: 12 },
    emailInbound: { backgroundColor: "rgba(59,77,59,0.06)" },
    emailOutbound: { backgroundColor: "rgba(224,122,95,0.12)" },
    emailMeta: { color: "rgba(36,49,36,0.55)", fontSize: 10, fontWeight: "700" },
    emailSubject: { color: palette.olive, fontSize: 12, fontWeight: "700" },
    emailBody: { color: palette.ink, fontSize: 12, lineHeight: 17 },
    emailInput: { minHeight: 64, maxHeight: 120, textAlignVertical: "top", fontWeight: "400" },
    approvalCard: {
        gap: 8,
        padding: 12,
        borderRadius: 14,
        backgroundColor: "rgba(224,122,95,0.12)",
        borderWidth: 1,
        borderColor: "rgba(224,122,95,0.35)",
    },
    approvalHint: { color: "rgba(36,49,36,0.65)", fontSize: 11, lineHeight: 16 },
    approvalActions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    toolResults: { gap: 6, marginTop: 4 },
    toolCard: {
        padding: 10,
        borderRadius: 12,
        backgroundColor: "rgba(59,77,59,0.06)",
        gap: 4,
    },
    toolCardRunning: {
        backgroundColor: "rgba(224,122,95,0.08)",
        borderWidth: 1,
        borderColor: "rgba(224,122,95,0.22)",
    },
    toolTop: { flexDirection: "row", alignItems: "center", gap: 8 },
    toolCheck: { color: palette.olive, fontSize: 14, fontWeight: "800", width: 18 },
    toolName: { color: palette.olive, fontSize: 11, fontWeight: "800", letterSpacing: 0.3 },
    toolDetail: { color: "rgba(36,49,36,0.72)", fontSize: 12, lineHeight: 16 },
});
