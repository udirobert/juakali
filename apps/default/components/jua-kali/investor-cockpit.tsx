import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
    AccessibilityInfo,
    ActivityIndicator,
    Platform,
    Pressable,
    ScrollView,
    Share,
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
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { Id } from "@/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";

import { api } from "@/convex/_generated/api";
import { SITE_URL } from "@/lib/site";
import { HowItWorksCard, TermHint } from "@/components/jua-kali/help";
import { AuthRequiredGate } from "@/components/jua-kali/soft-identity";
import { SunMark } from "@/components/jua-kali/sun-mark";
import { color, font, layout } from "@/components/jua-kali/theme";

type Cockpit = FunctionReturnType<typeof api.invest.investorCockpit>;
type Commitment = Cockpit["commitments"][number];
type AgentRun = NonNullable<FunctionReturnType<typeof api.agentRuns.getAgentRun>>;
type RunStep = AgentRun["steps"][number];
type AgentPhase = "idle" | "queued" | "acting" | "done" | "failed";

function readDealParams(): { commitmentId?: Id<"commitments">; ventureSlug?: string } {
    if (Platform.OS !== "web" || typeof window === "undefined") return {};
    const params = new URLSearchParams(window.location.search);
    const c = params.get("c");
    const v = params.get("v");
    return {
        commitmentId: c ? (c as Id<"commitments">) : undefined,
        ventureSlug: v?.trim() || undefined,
    };
}

function formatKes(value: number) {
    return `KES ${value.toLocaleString()}`;
}

function formatDue(ts: number | null) {
    if (!ts) return "—";
    return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDueLabel(ts: number | null) {
    if (!ts) return "Next digest —";
    return `Next digest · ${formatDue(ts)}`;
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

export function InvestorCockpit({
    initialCommitmentId,
    showCoach = false,
    onDismissCoach,
    onOpenGlossary,
    hideBrand = false,
    fidelityHint,
    requireAuthToAct = false,
    onOpenLedger,
}: {
    initialCommitmentId?: Id<"commitments">;
    showCoach?: boolean;
    onDismissCoach?: () => void;
    onOpenGlossary?: (focusId?: string) => void;
    hideBrand?: boolean;
    fidelityHint?: string;
    requireAuthToAct?: boolean;
    onOpenLedger?: () => void;
} = {}) {
    const dealParams = useMemo(() => {
        const fromUrl = readDealParams();
        return {
            commitmentId: initialCommitmentId ?? fromUrl.commitmentId,
            ventureSlug: fromUrl.ventureSlug,
        };
    }, [initialCommitmentId]);

    const data = useQuery(api.invest.investorCockpit, {
        commitmentId: dealParams.commitmentId,
        ventureSlug: dealParams.ventureSlug,
    });
    const { isAuthenticated } = useConvexAuth();
    const me = useQuery(api.softAuth.whoAmI);
    const agentMail = useQuery(api.agentMailPublic.publicStatus);
    const seedInvestDemo = useMutation(api.invest.seedInvestDemo);
    const pledgeCommitment = useMutation(api.invest.pledgeCommitment);
    const startAgentRun = useMutation(api.agentRuns.startAgentRun);
    const insets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    const compact = width < 440;
    const padX = Math.max(14, Math.min(28, (width - layout.maxWidth) / 2 + 16));

    const [selectedCommitmentId, setSelectedCommitmentId] = useState<Id<"commitments"> | null>(
        dealParams.commitmentId ?? null
    );
    const [selectedVentureId, setSelectedVentureId] = useState<Id<"ventures"> | null>(null);
    const [amountText, setAmountText] = useState("10000");
    const [emailDraft, setEmailDraft] = useState("Push follow-ups this week. Reply with what moved.");
    const [pendingBody, setPendingBody] = useState<string | null>(null);
    const [agentPhase, setAgentPhase] = useState<AgentPhase>("idle");
    const [activeRunId, setActiveRunId] = useState<Id<"agentRuns"> | null>(null);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [isSeeding, setIsSeeding] = useState(false);
    const [isPledging, setIsPledging] = useState(false);
    const [showPledge, setShowPledge] = useState(false);
    const [showThread, setShowThread] = useState(false);
    const [showIntegrations, setShowIntegrations] = useState(false);
    const [actingSeconds, setActingSeconds] = useState(0);

    /** Live subscription to the run we approved — steps update as each commits. */
    const activeRun = useQuery(
        api.agentRuns.getAgentRun,
        activeRunId ? { runId: activeRunId } : "skip"
    );

    /** Live subscription to the commitment's latest run — catches inbound AgentMail runs too. */
    const inboundRun = useQuery(
        api.agentRuns.getLatestRun,
        selectedCommitmentId ? { commitmentId: selectedCommitmentId } : "skip"
    );
    const inboundRunDetail = useQuery(
        api.agentRuns.getAgentRun,
        inboundRun && inboundRun.id !== activeRunId && inboundRun.status === "running"
            ? { runId: inboundRun.id }
            : "skip"
    );

    useEffect(() => {
        if (!data?.focusCommitmentId) return;
        setSelectedCommitmentId((prev) => prev ?? data.focusCommitmentId);
    }, [data?.focusCommitmentId]);

    const selectedCommitment: Commitment | null = useMemo(() => {
        if (!data || data.commitments.length === 0) return null;
        const id = selectedCommitmentId ?? data.focusCommitmentId ?? data.commitments[0]!.id;
        return data.commitments.find((row) => row.id === id) ?? data.commitments[0]!;
    }, [data, selectedCommitmentId]);

    // If the selected commitment changes, drop any run state that belongs to the old one.
    useEffect(() => {
        if (!activeRunId || !selectedCommitment) return;
        if (activeRun && activeRun.commitmentId !== selectedCommitment.id) {
            setActiveRunId(null);
            setAgentPhase("idle");
        }
    }, [activeRunId, activeRun, selectedCommitment]);

    const selectedVenture = useMemo(() => {
        if (!data) return null;
        const id = selectedVentureId ?? data.availableVentures[0]?.id ?? null;
        return data.availableVentures.find((venture) => venture.id === id) ?? null;
    }, [data, selectedVentureId]);

    const empty = data !== undefined && data.commitments.length === 0;

    // The run currently in flight: ours if any, else a live inbound email run.
    const liveRun = activeRun ?? inboundRunDetail ?? null;
    const runIsOurs = liveRun != null && activeRun != null && liveRun.id === activeRun.id;
    const waiting = agentPhase === "queued" || (liveRun?.status === "running" && runIsOurs);

    // Derive UI phase from real run state instead of simulating it.
    // Completion/failure only updates our local phase for runs we own — an
    // inbound email run finishing must not clobber a draft the user is typing.
    useEffect(() => {
        if (!liveRun) return;
        if (liveRun.status === "running") {
            if (runIsOurs) setAgentPhase("acting");
        } else if (liveRun.status === "completed") {
            if (runIsOurs) {
                setAgentPhase("done");
                setPendingBody(null);
                setEmailDraft("");
                setStatusMessage(liveRun.result?.message ?? "Agent run completed.");
                void AccessibilityInfo.announceForAccessibility("Done. Digest and ledger updated.");
            }
        } else if (liveRun.status === "failed") {
            if (runIsOurs) {
                setAgentPhase("failed");
                setStatusMessage(liveRun.error ?? "Agent run failed.");
            }
        }
        // Phase only changes when the run's status (or ownership) changes;
        // depending on the whole run object would re-fire on every step commit.
    }, [liveRun?.status, runIsOurs]);

    useEffect(() => {
        if (liveRun?.status !== "running") {
            setActingSeconds(0);
            return;
        }
        const started = liveRun.createdAt;
        const tick = () => setActingSeconds(Math.max(0, Math.floor((Date.now() - started) / 1000)));
        tick();
        const id = setInterval(tick, 250);
        return () => clearInterval(id);
    }, [liveRun?.status, liveRun?.createdAt]);

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
        // Drop the previous run's chips so the approval gate reads clean.
        setActiveRunId(null);
        setPendingBody(body);
        setAgentPhase("queued");
        setStatusMessage(null);
        void AccessibilityInfo.announceForAccessibility("Queued. Awaiting approval.");
    }

    function handleDiscardQueue() {
        setPendingBody(null);
        setAgentPhase("idle");
    }

    /**
     * Approve & run — creates a durable agent run; the UI then streams real
     * step state from Convex subscriptions (no simulated chips or delays).
     */
    const handleApproveEmail = useCallback(async () => {
        if (!pendingBody || !selectedCommitment) return;
        setAgentPhase("acting");
        setStatusMessage(null);
        try {
            const result = await startAgentRun({
                commitmentId: selectedCommitment.id,
                noteBody: pendingBody,
            });
            setActiveRunId(result.runId);
        } catch (error) {
            setAgentPhase("failed");
            setStatusMessage(error instanceof Error ? error.message : "Could not start run.");
        }
    }, [pendingBody, selectedCommitment, startAgentRun]);

    if (data === undefined) {
        return (
            <View style={[styles.loadingScreen, { paddingTop: insets.top }]}>
                <ActivityIndicator color={color.brass} />
            </View>
        );
    }

    return (
        <View style={[styles.screen, { paddingTop: hideBrand ? 8 : insets.top }]}>
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
                        {hideBrand ? (
                            <Text style={styles.heroTitle}>
                                {isAuthenticated && me?.name
                                    ? `Your deals, ${me.name.split(/\s+/)[0]}`
                                    : "Your deals"}
                            </Text>
                        ) : (
                            <Text style={styles.brand}>JuaKali</Text>
                        )}
                        <PressableScale onPress={() => setShowPledge((v) => !v)} style={styles.btnGhost}>
                            <Text style={styles.btnGhostText}>{showPledge ? "Close" : "New pledge"}</Text>
                        </PressableScale>
                    </View>
                    <Text style={styles.bridge}>
                        Deals = act · Ledger = public proof
                    </Text>
                    {statusMessage ? <Text style={styles.status}>{statusMessage}</Text> : null}
                </View>

                {onDismissCoach ? (
                    <HowItWorksCard
                        visible={showCoach}
                        onDismiss={onDismissCoach}
                        onOpenGlossary={onOpenGlossary ? () => onOpenGlossary() : undefined}
                        compact={compact}
                    />
                ) : null}

                <View style={styles.integrations}>
                    <Pressable onPress={() => setShowIntegrations((v) => !v)} hitSlop={8}>
                        <View style={styles.integrationsHead}>
                            <Text style={styles.integrationsLabel}>Email & cadence</Text>
                            <Text style={styles.threadToggle}>{showIntegrations ? "Hide" : "More"}</Text>
                        </View>
                    </Pressable>
                    <Text style={styles.integrationsBody}>
                        {agentMail?.inboxEmail ?? "In-app notes: queue → approve"}
                    </Text>
                    {showIntegrations ? (
                        <>
                            <Text style={styles.fieldHint}>
                                {fidelityHint ??
                                    "Soft pledges (not escrow) · AgentMail inbox live for inbound notes · Gmail later."}
                            </Text>
                            {agentMail?.configured && agentMail.inboxEmail ? (
                                <Text style={styles.fieldHint}>
                                    Email it (subject: venture:slug) — or queue a note below and approve.
                                </Text>
                            ) : (
                                <Text style={styles.fieldHint}>Weekly cadence, not calendar sync.</Text>
                            )}
                        </>
                    ) : null}
                </View>

                {showPledge ? (
                    <AuthRequiredGate required={requireAuthToAct}>
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
                        {data.availableVentures.length === 0 ? (
                            <Text style={styles.status}>No ventures yet — start a commitment from the landing.</Text>
                        ) : (
                            <Text style={styles.fieldHint}>Pick a venture · set a soft amount (intent only).</Text>
                        )}
                        <TextInput
                            value={amountText}
                            onChangeText={setAmountText}
                            keyboardType="number-pad"
                            style={styles.input}
                            placeholder="Amount in KES"
                            placeholderTextColor={color.mist}
                        />
                        <PressableScale
                            onPress={handlePledge}
                            disabled={isPledging || !selectedVenture}
                            style={styles.btnPrimary}
                        >
                            <Text style={styles.btnPrimaryText}>{isPledging ? "…" : "Record soft pledge"}</Text>
                        </PressableScale>
                        {onOpenGlossary ? (
                            <Pressable onPress={() => onOpenGlossary("soft-pledge")}>
                                <Text style={styles.inlineLink}>What is a soft pledge?</Text>
                            </Pressable>
                        ) : null}
                    </Animated.View>
                    </AuthRequiredGate>
                ) : null}

                {empty ? (
                    <View style={styles.emptyCard}>
                        <View style={styles.emptyGlyph}>
                            <View style={styles.emptyRing} />
                            <View style={[styles.emptyRing, styles.emptyRingInner]} />
                        </View>
                        <Text style={styles.emptyTitle}>No deal yet</Text>
                        <Text style={styles.status}>Pledge a venture, or load seeded deals to explore.</Text>
                        <PressableScale
                            onPress={() => setShowPledge(true)}
                            style={styles.btnPrimary}
                            disabled={data.availableVentures.length === 0}
                        >
                            <Text style={styles.btnPrimaryText}>New pledge</Text>
                        </PressableScale>
                        <PressableScale onPress={handleSeed} disabled={isSeeding} style={styles.btnGhost}>
                            <Text style={styles.btnGhostText}>{isSeeding ? "…" : "Load seeded deals"}</Text>
                        </PressableScale>
                    </View>
                ) : (
                    <>
                        <Text style={styles.stripLabel}>Your deals</Text>
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
                                <Scorecard
                                    commitment={selectedCommitment}
                                    onOpenGlossary={onOpenGlossary}
                                />
                                <AuthRequiredGate required={requireAuthToAct}>
                                <Ritual
                                    commitment={selectedCommitment}
                                    draft={emailDraft}
                                    onChangeDraft={setEmailDraft}
                                    pendingBody={pendingBody}
                                    agentPhase={agentPhase}
                                    liveRun={liveRun}
                                    runIsOurs={runIsOurs}
                                    waiting={waiting}
                                    actingSeconds={actingSeconds}
                                    showThread={showThread}
                                    onToggleThread={() => setShowThread((v) => !v)}
                                    onQueue={handleQueueEmail}
                                    onApprove={() => void handleApproveEmail()}
                                    onDiscard={handleDiscardQueue}
                                    onOpenLedger={onOpenLedger}
                                    onOpenGlossary={onOpenGlossary}
                                />
                                </AuthRequiredGate>
                                {selectedCommitment.latestDigest ? (
                                    <DigestArtifactCard
                                        commitment={selectedCommitment}
                                        onOpenLedger={onOpenLedger}
                                        onOpenGlossary={onOpenGlossary}
                                    />
                                ) : null}
                            </View>
                        ) : null}
                    </>
                )}
            </ScrollView>
        </View>
    );
}

function Scorecard({
    commitment,
    onOpenGlossary,
}: {
    commitment: Commitment;
    onOpenGlossary?: (focusId?: string) => void;
}) {
    const { venture } = commitment;
    const peer = venture.peerMedian;
    const progress = venture.kpiTarget > 0 ? Math.min(1, venture.kpiTotal / venture.kpiTarget) : 0;

    return (
        <View style={styles.card}>
            <View style={styles.cardTop}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                    {venture.name}
                </Text>
                <View style={styles.dueRow}>
                    <Text style={styles.meta}>{formatDueLabel(commitment.nextDigestAt)}</Text>
                </View>
            </View>

            <View style={styles.metrics}>
                <Metric
                    value={venture.kpiTotal}
                    label={venture.kpiLabel}
                    termId="kpi"
                    onOpenGlossary={onOpenGlossary}
                />
                <Metric value={venture.kpiTarget} label="Target" />
                <Metric value={peer ?? "—"} label="Similar" />
            </View>

            <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
            </View>
            <Sparkline values={venture.sparkline} />

            <View style={styles.shareRow}>
                <Pressable
                    onPress={async () => {
                        const url = `${SITE_URL}/deal/${venture.publicSlug}`;
                        try {
                            await Share.share({
                                message: `${venture.name} — public ledger\n${url}`,
                                url,
                                title: `${venture.name} — public ledger`,
                            });
                        } catch {
                            // dismissed — nothing to do
                        }
                    }}
                    hitSlop={6}
                    accessibilityRole="button"
                >
                    <Text style={styles.shareLink}>Share proof</Text>
                </Pressable>
                <Text style={styles.shareHint}>/deal/{venture.publicSlug}</Text>
            </View>

            {commitment.latestDigest ? (
                <Text style={styles.fieldHint}>
                    Latest digest filed below · next due{" "}
                    {commitment.nextDigestAt ? formatDue(commitment.nextDigestAt) : "this week"}.
                </Text>
            ) : (
                <Text style={styles.fieldHint}>No digest yet — approve a note below to generate one.</Text>
            )}
        </View>
    );
}

function Metric({
    value,
    label,
    termId,
    onOpenGlossary,
}: {
    value: number | string;
    label: string;
    termId?: string;
    onOpenGlossary?: (focusId?: string) => void;
}) {
    return (
        <View style={styles.metric}>
            <Text style={styles.metricValue}>{value}</Text>
            <View style={styles.metricLabelRow}>
                <Text style={styles.metricLabel} numberOfLines={1}>
                    {label}
                </Text>
                {termId && onOpenGlossary ? <TermHint termId={termId} onOpenGlossary={onOpenGlossary} /> : null}
            </View>
        </View>
    );
}

function Ritual({
    commitment,
    draft,
    onChangeDraft,
    pendingBody,
    agentPhase,
    liveRun,
    runIsOurs,
    waiting,
    actingSeconds,
    showThread,
    onToggleThread,
    onQueue,
    onApprove,
    onDiscard,
    onOpenLedger,
    onOpenGlossary,
}: {
    commitment: Commitment;
    draft: string;
    onChangeDraft: (value: string) => void;
    pendingBody: string | null;
    agentPhase: AgentPhase;
    liveRun: AgentRun | null;
    runIsOurs: boolean;
    waiting: boolean;
    actingSeconds: number;
    showThread: boolean;
    onToggleThread: () => void;
    onQueue: () => void;
    onApprove: () => void;
    onDiscard: () => void;
    onOpenLedger?: () => void;
    onOpenGlossary?: (focusId?: string) => void;
}) {
    const emails = commitment.recentEmails;
    const runLive = liveRun?.status === "running";
    const inboundActing = !runIsOurs && runLive && agentPhase !== "queued";
    const showApproveGate = pendingBody != null && agentPhase === "queued";
    const showSteps = liveRun != null && (runIsOurs || inboundActing);

    const phaseLabel = showApproveGate
        ? "Waiting for your approval"
        : runLive
          ? `Working · ${actingSeconds}s`
          : agentPhase === "acting"
            ? "Working…"
            : agentPhase === "done" && liveRun?.status === "completed"
              ? "Done — posted to Ledger"
              : agentPhase === "failed" || liveRun?.status === "failed"
                ? "Run failed"
                : "Ready for a note";

    return (
        <View style={styles.card}>
            <View style={styles.cardTop}>
                <View style={styles.titleWithHint}>
                    <SunMark size={16} />
                    <Text style={styles.cardTitle}>Note to Jua</Text>
                    {onOpenGlossary ? <TermHint termId="queue-approve" onOpenGlossary={onOpenGlossary} /> : null}
                </View>
                <Text style={[styles.meta, liveRun?.status === "failed" && styles.metaDanger]}>
                    {phaseLabel}
                </Text>
            </View>

            <Text style={styles.fieldHint}>
                {inboundActing
                    ? "Jua is acting on an inbound email — live steps below."
                    : "Write a note, then approve to run — or email the inbox above."}
            </Text>

            <WaitingShimmer active={waiting} />

            {showSteps && liveRun ? (
                <RunSteps run={liveRun} onOpenLedger={onOpenLedger} />
            ) : null}

            {showApproveGate ? (
                <Animated.View entering={FadeInDown.duration(160)} style={styles.gate}>
                    <Text style={styles.gateEyebrow}>Queued — approve to run</Text>
                    <Text style={styles.gateBody} numberOfLines={6}>
                        {pendingBody}
                    </Text>
                    <View style={styles.consequence}>
                        <Text style={styles.consequenceLabel}>Approving will</Text>
                        {["Log a KPI check-in", "Write an investor digest", "Post to the public ledger", "Reply with evidence"].map(
                            (line) => (
                                <Text key={line} style={styles.consequenceLine}>
                                    · {line}
                                </Text>
                            )
                        )}
                    </View>
                    <PressableScale onPress={onApprove} style={styles.btnApprove}>
                        <Text style={styles.btnApproveText}>Approve & run</Text>
                    </PressableScale>
                    <Pressable onPress={onDiscard}>
                        <Text style={styles.discard}>Discard</Text>
                    </Pressable>
                </Animated.View>
            ) : !runLive ? (
                <View style={styles.composer}>
                    <TextInput
                        value={draft}
                        onChangeText={onChangeDraft}
                        multiline
                        style={styles.composerInput}
                        placeholder="Note to agent — e.g. push follow-ups, reply with what moved"
                        placeholderTextColor={color.mist}
                        maxLength={320}
                    />
                    <PressableScale onPress={onQueue} style={styles.btnPrimary}>
                        <Text style={styles.btnPrimaryText}>Send to agent</Text>
                    </PressableScale>
                </View>
            ) : null}

            {emails.length > 0 ? (
                <Pressable onPress={onToggleThread}>
                    <Text style={styles.threadToggle}>
                        {showThread ? "Hide thread" : `Email thread · ${emails.length}`}
                    </Text>
                </Pressable>
            ) : null}
            {showThread
                ? emails.map((email) => (
                      <View key={email.id} style={styles.bubble}>
                          <Text style={styles.bubbleMeta}>
                              {email.direction === "inbound" ? "You" : "Jua"}
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

/** Live step chips driven by the real agentRun — nothing is simulated. */
function RunSteps({
    run,
    onOpenLedger,
}: {
    run: AgentRun;
    onOpenLedger?: () => void;
}) {
    const failed = run.status === "failed";
    const done = run.status === "completed";
    return (
        <View style={styles.toolRow} accessibilityLiveRegion="polite">
            {run.steps.map((step: RunStep) => (
                <View
                    key={step.tool}
                    style={[
                        styles.toolChip,
                        step.status === "running" && styles.toolChipRun,
                        step.status === "failed" && styles.toolChipFail,
                    ]}
                >
                    {step.status === "running" ? (
                        <ActivityIndicator size="small" color={color.brass} />
                    ) : step.status === "done" ? (
                        <Text style={styles.toolOk}>✓</Text>
                    ) : step.status === "failed" ? (
                        <Text style={styles.toolFail}>✕</Text>
                    ) : (
                        <View style={styles.toolDot} />
                    )}
                    <Text style={styles.toolName} numberOfLines={1}>
                        {step.label}
                    </Text>
                </View>
            ))}
            {done && run.result ? (
                <View style={styles.runDone}>
                    <Text style={styles.runDoneText} numberOfLines={2}>
                        {run.result.message} · KPI {run.result.kpiBefore} → {run.result.kpiAfter}
                    </Text>
                    {onOpenLedger ? (
                        <Pressable onPress={onOpenLedger} hitSlop={8}>
                            <Text style={styles.runDoneLink}>View on Ledger</Text>
                        </Pressable>
                    ) : null}
                </View>
            ) : null}
            {failed && run.error ? (
                <Text style={styles.runError}>{run.error}</Text>
            ) : null}
        </View>
    );
}

/** The core artifact: the agent's digest, rendered as a first-class card. */
function DigestArtifactCard({
    commitment,
    onOpenLedger,
    onOpenGlossary,
}: {
    commitment: Commitment;
    onOpenLedger?: () => void;
    onOpenGlossary?: (focusId?: string) => void;
}) {
    const digest = commitment.latestDigest;
    if (!digest) return null;

    const evidence = digest.evidence.length > 0 ? digest.evidence : ["agent"];

    return (
        <View style={styles.card}>
            <View style={styles.cardTop}>
                <View style={styles.titleWithHint}>
                    <SunMark size={16} />
                    <Text style={styles.digestTitle}>Digest</Text>
                    {onOpenGlossary ? <TermHint termId="digest" onOpenGlossary={onOpenGlossary} /> : null}
                </View>
                <Text style={styles.digestWhen}>
                    {new Date(digest.createdAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                    })}
                </Text>
            </View>

            <Text style={styles.digestSummary}>{digest.summary}</Text>

            <View style={styles.digestRule} />

            <View style={styles.digestSection}>
                <Text style={styles.digestSectionLabel}>Insight</Text>
                <Text style={styles.digestSectionBody}>{digest.insights}</Text>
            </View>
            {digest.nextAction ? (
                <View style={styles.digestSection}>
                    <Text style={styles.digestSectionLabel}>Next</Text>
                    <Text style={styles.digestSectionBody}>{digest.nextAction}</Text>
                </View>
            ) : null}

            <View style={styles.digestFoot}>
                <View style={styles.digestEvidenceRow}>
                    <Text style={styles.digestEvidenceLabel}>Evidence</Text>
                    {evidence.map((tag: string) => (
                        <View key={tag} style={styles.evidenceChip}>
                            <Text style={styles.evidenceChipText}>{tag}</Text>
                        </View>
                    ))}
                </View>
                {onOpenLedger ? (
                    <Pressable onPress={onOpenLedger} hitSlop={8}>
                        <Text style={styles.runDoneLink}>View on Ledger</Text>
                    </Pressable>
                ) : null}
            </View>
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
    heroTitle: {
        fontFamily: font.displayMedium,
        fontSize: 22,
        fontWeight: "600",
        letterSpacing: -0.4,
        color: color.charcoal,
    },
    bridge: {
        fontFamily: font.body,
        fontSize: 12,
        lineHeight: 17,
        color: color.mist,
    },
    integrations: {
        gap: 6,
        padding: 12,
        borderRadius: 6,
        backgroundColor: color.paper,
        borderWidth: 1,
        borderColor: color.line,
    },
    integrationsHead: { flexDirection: "row", alignItems: "center", gap: 6 },
    integrationsLabel: {
        fontFamily: font.bodyBold,
        fontSize: 10,
        fontWeight: "700",
        letterSpacing: 0.8,
        textTransform: "uppercase",
        color: color.brassDeep,
        marginRight: 2,
    },
    integrationsBody: {
        fontFamily: font.body,
        fontSize: 12,
        lineHeight: 17,
        color: color.mist,
    },
    inboxRow: { gap: 4, marginTop: 2 },
    inboxLabel: {
        fontFamily: font.bodyBold,
        fontSize: 10,
        fontWeight: "700",
        letterSpacing: 0.6,
        textTransform: "uppercase",
        color: color.brassDeep,
    },
    inboxAddress: {
        fontFamily: font.bodyBold,
        fontSize: 14,
        fontWeight: "700",
        color: color.charcoal,
    },
    fieldHint: {
        fontFamily: font.body,
        fontSize: 12,
        lineHeight: 17,
        color: color.mist,
    },
    inlineLink: {
        fontFamily: font.bodyBold,
        fontSize: 12,
        fontWeight: "700",
        color: color.brassDeep,
        textAlign: "center",
        paddingVertical: 4,
    },
    stripLabel: {
        fontFamily: font.bodyBold,
        fontSize: 10,
        fontWeight: "700",
        letterSpacing: 0.8,
        textTransform: "uppercase",
        color: color.mist,
    },
    dueRow: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 },
    titleWithHint: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1 },
    insightHead: { flexDirection: "row", alignItems: "center", gap: 6 },
    metricLabelRow: { flexDirection: "row", alignItems: "center", gap: 3 },
    gateEyebrow: {
        fontFamily: font.bodyBold,
        fontSize: 10,
        fontWeight: "700",
        letterSpacing: 0.6,
        textTransform: "uppercase",
        color: color.brassDeep,
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
    status: { fontFamily: font.body, fontSize: 12, color: color.brassDeep, textAlign: "center" },
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
    metaDanger: { color: color.danger },
    // Brass is the trust/permission color — the consequential approve action is
    // visually distinct from ordinary charcoal navigation buttons.
    btnApprove: {
        backgroundColor: color.brass,
        paddingHorizontal: 18,
        paddingVertical: 13,
        borderRadius: 4,
        minHeight: 46,
        justifyContent: "center",
        alignItems: "center",
    },
    btnApproveText: {
        fontFamily: font.bodyBold,
        color: color.paper,
        fontWeight: "700",
        fontSize: 14,
        letterSpacing: 0.3,
    },
    consequence: {
        gap: 3,
        padding: 10,
        borderRadius: 4,
        backgroundColor: color.stone,
        borderWidth: 1,
        borderColor: color.line,
    },
    consequenceLabel: {
        fontFamily: font.bodyBold,
        fontSize: 9,
        fontWeight: "700",
        letterSpacing: 0.8,
        textTransform: "uppercase",
        color: color.mist,
        marginBottom: 2,
    },
    consequenceLine: { fontFamily: font.body, fontSize: 12, lineHeight: 17, color: color.ink },
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
    shareRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
    },
    shareLink: {
        fontFamily: font.bodyBold,
        fontSize: 12,
        fontWeight: "700",
        color: color.brassDeep,
    },
    shareHint: {
        fontFamily: font.body,
        fontSize: 11,
        color: color.mist,
    },
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
        color: color.brassDeep,
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
    toolRow: { gap: 6 },
    toolChip: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 4,
        backgroundColor: color.stone,
    },
    toolChipRun: { backgroundColor: color.brassSoft },
    toolChipFail: { backgroundColor: "rgba(139,58,47,0.08)" },
    toolOk: { color: color.success, fontWeight: "700", fontSize: 12 },
    toolFail: { color: color.danger, fontWeight: "700", fontSize: 12 },
    toolDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.lineStrong },
    toolName: { fontFamily: font.bodyBold, fontSize: 11, fontWeight: "700", color: color.charcoal, flexShrink: 1 },
    runDone: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        paddingHorizontal: 2,
        paddingTop: 2,
    },
    runDoneText: { fontFamily: font.body, fontSize: 12, lineHeight: 17, color: color.ink, flex: 1 },
    runDoneLink: { fontFamily: font.bodyBold, fontSize: 12, fontWeight: "700", color: color.brassDeep },
    runError: { fontFamily: font.body, fontSize: 12, color: color.danger },
    // Digest artifact card
    digestTitle: {
        fontFamily: font.displayMedium,
        fontSize: 18,
        fontWeight: "600",
        color: color.charcoal,
        flex: 1,
    },
    digestWhen: { fontFamily: font.bodyBold, fontSize: 11, fontWeight: "700", color: color.mist },
    digestSummary: { fontFamily: font.body, fontSize: 14, lineHeight: 21, color: color.ink },
    digestRule: { height: 1, backgroundColor: color.line },
    digestSection: { gap: 3 },
    digestSectionLabel: {
        fontFamily: font.bodyBold,
        fontSize: 9,
        fontWeight: "700",
        letterSpacing: 0.8,
        textTransform: "uppercase",
        color: color.brassDeep,
    },
    digestSectionBody: { fontFamily: font.body, fontSize: 13, lineHeight: 19, color: color.ink },
    digestFoot: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
    },
    digestEvidenceRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", flex: 1 },
    digestEvidenceLabel: {
        fontFamily: font.bodyBold,
        fontSize: 9,
        fontWeight: "700",
        letterSpacing: 0.8,
        textTransform: "uppercase",
        color: color.mist,
    },
    evidenceChip: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 4,
        backgroundColor: color.brassSoft,
        borderWidth: 1,
        borderColor: "rgba(166,124,45,0.25)",
    },
    evidenceChipText: {
        fontFamily: font.bodyBold,
        fontSize: 10,
        fontWeight: "700",
        letterSpacing: 0.4,
        textTransform: "uppercase",
        color: color.brassDeep,
    },
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
