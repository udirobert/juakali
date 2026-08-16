import { useCallback, useEffect, useMemo, useState } from "react";
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
import Svg, { Circle as SvgCircle, Path as SvgPath } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
    FadeInDown,
    useAnimatedProps,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withRepeat,
    withTiming,
} from "react-native-reanimated";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { Id } from "@/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";

import { api } from "@/convex/_generated/api";
import { SITE_URL } from "@/lib/site";
import { HowItWorksCard, TermHint } from "@/components/jua-kali/help";
import { successHaptic } from "@/components/jua-kali/haptics";
import { AuthRequiredGate } from "@/components/jua-kali/soft-identity";
import { SunMark } from "@/components/jua-kali/sun-mark";
import { LivingSun } from "@/components/jua-kali/living-sun";
import { IconCheck, IconSend, IconShare, IconX } from "@/components/jua-kali/icons";
import { Button, Card, Chip, Input } from "@/components/jua-kali/ui";
import { color, font, layout, motion, tabularNums } from "@/components/jua-kali/theme";

const AnimatedPath = Animated.createAnimatedComponent(SvgPath);

type Cockpit = FunctionReturnType<typeof api.invest.investorCockpit>;
type Commitment = Cockpit["commitments"][number];
type AgentRun = NonNullable<FunctionReturnType<typeof api.agentRuns.getAgentRun>>;
type LatestRun = NonNullable<FunctionReturnType<typeof api.agentRuns.getLatestRun>>;
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

/** Human relative time — makes the agent's activity feel present, not archival. */
function relativeTime(ts: number): string {
    const mins = Math.floor((Date.now() - ts) / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return "yesterday";
    return `${days} days ago`;
}

function daysUntil(ts: number): number {
    return Math.max(0, Math.ceil((ts - Date.now()) / (24 * 60 * 60 * 1000)));
}

function formatDue(ts: number | null) {
    if (!ts) return "—";
    return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDueLabel(ts: number | null) {
    if (!ts) return "Next digest —";
    return `Next digest · ${formatDue(ts)}`;
}

/**
 * The KPI line — a real drawn sparkline instead of bars. The line draws
 * itself in when data arrives or changes; the last point lands in brass.
 */
function Sparkline({ values }: { values: number[] }) {
    const reduceMotion = useReducedMotion();
    const [width, setWidth] = useState(0);
    const height = 34;
    const pad = 3;

    const recent = values.slice(-14);
    const max = Math.max(...recent, 1);
    const min = Math.min(...recent, 0);
    const range = max - min || 1;

    const points = recent.map((value, index) => ({
        x: pad + (recent.length === 1 ? 0 : (index / (recent.length - 1)) * (width - pad * 2)),
        y: pad + (1 - (value - min) / range) * (height - pad * 2),
    }));

    const pathD = points
        .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
        .join(" ");
    const pathLength = points.reduce(
        (acc, p, i) => (i === 0 ? 0 : acc + Math.hypot(p.x - points[i - 1]!.x, p.y - points[i - 1]!.y)),
        0,
    );

    const dash = useSharedValue(reduceMotion ? 0 : pathLength);
    useEffect(() => {
        if (width <= 0) return;
        if (reduceMotion) {
            dash.value = 0;
            return;
        }
        dash.value = pathLength;
        dash.value = withTiming(0, { duration: 480 });
    }, [pathLength, width, reduceMotion, dash]);

    const animatedProps = useAnimatedProps(() => ({
        strokeDashoffset: dash.value,
    }));

    if (recent.length === 0 || width <= 0) {
        return <View style={styles.sparkTrack} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} />;
    }
    const last = points[points.length - 1]!;

    return (
        <View style={styles.sparkTrack} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
            <Svg width={width} height={height}>
                <AnimatedPath
                    d={pathD}
                    fill="none"
                    stroke={color.charcoal}
                    strokeWidth={1.75}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray={`${pathLength} ${pathLength}`}
                    strokeDashoffset={pathLength}
                    animatedProps={animatedProps}
                />
                <SvgCircle cx={last.x} cy={last.y} r={2.6} fill={color.brass} />
            </Svg>
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

export function InvestorCockpit({
    initialCommitmentId,
    showCoach = false,
    onDismissCoach,
    onOpenGlossary,
    hideBrand = false,
    requireAuthToAct = false,
    onOpenLedger,
}: {
    initialCommitmentId?: Id<"commitments">;
    showCoach?: boolean;
    onDismissCoach?: () => void;
    onOpenGlossary?: (focusId?: string) => void;
    hideBrand?: boolean;
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
    const approveProposal = useMutation(api.agentRuns.approveProposal);
    const dismissProposal = useMutation(api.agentRuns.dismissProposal);
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
    /** The commitment our active run belongs to — known locally, no re-subscribe. */
    const [activeRunCommitmentId, setActiveRunCommitmentId] = useState<Id<"commitments"> | null>(null);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [isSeeding, setIsSeeding] = useState(false);
    const [isPledging, setIsPledging] = useState(false);
    const [showPledge, setShowPledge] = useState(false);

    /**
     * Thin status line only: the commitment's latest run (id/status/trigger).
     * The heavy per-step subscription lives inside Ritual, so step commits
     * re-render the ritual card — not the whole cockpit.
     */
    const inboundRun = useQuery(
        api.agentRuns.getLatestRun,
        selectedCommitmentId ? { commitmentId: selectedCommitmentId } : "skip"
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
        if (!activeRunId || !activeRunCommitmentId || !selectedCommitment) return;
        if (activeRunCommitmentId !== selectedCommitment.id) {
            setActiveRunId(null);
            setActiveRunCommitmentId(null);
            setAgentPhase("idle");
        }
    }, [activeRunId, activeRunCommitmentId, selectedCommitment]);

    const selectedVenture = useMemo(() => {
        if (!data) return null;
        const id = selectedVentureId ?? data.availableVentures[0]?.id ?? null;
        return data.availableVentures.find((venture) => venture.id === id) ?? null;
    }, [data, selectedVentureId]);

    const empty = data !== undefined && data.commitments.length === 0;

    /** A live run that isn't ours (e.g. AgentMail) — narrated, never owned. */
    const liveInbound =
        inboundRun && inboundRun.status === "running" && inboundRun.id !== activeRunId ? inboundRun : null;

    // Run lifecycle — Ritual streams the run; root only hears transitions,
    // and only for runs we own. Inbound runs never clobber local drafts.
    const handleRunRunning = useCallback(() => setAgentPhase("acting"), []);
    const handleRunCompleted = useCallback((message: string) => {
        setAgentPhase("done");
        setPendingBody(null);
        setEmailDraft("");
        setStatusMessage(message);
        successHaptic();
        void AccessibilityInfo.announceForAccessibility("Done. Digest and ledger updated.");
    }, []);
    const handleRunFailed = useCallback((error: string) => {
        setAgentPhase("failed");
        setStatusMessage(error);
    }, []);

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
        // Optimistic close — the form collapses immediately and Convex
        // confirms behind it; on error the form reopens with the reason.
        setIsPledging(true);
        setShowPledge(false);
        setStatusMessage("Pledge recorded — syncing…");
        try {
            const result = await pledgeCommitment({ ventureId: selectedVenture.id, amountKes });
            setSelectedCommitmentId(result.commitmentId);
            setStatusMessage(result.message);
        } catch (error) {
            setStatusMessage(error instanceof Error ? error.message : "Could not pledge.");
            setShowPledge(true);
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
        setStatusMessage("Approved — Jua is working.");
        setActiveRunCommitmentId(selectedCommitment.id);
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

    /** Approve Jua's proactive suggestion — the same durable pipeline streams. */
    const handleApproveProposal = useCallback(
        async (runId: Id<"agentRuns">) => {
            if (!selectedCommitment) return;
            setAgentPhase("acting");
            setStatusMessage("Approved — Jua is working.");
            setActiveRunId(null);
            setActiveRunCommitmentId(selectedCommitment.id);
            try {
                const result = await approveProposal({ runId });
                setActiveRunId(result.runId);
                void AccessibilityInfo.announceForAccessibility("Approved. Jua is working.");
            } catch (error) {
                setAgentPhase("idle");
                setStatusMessage(error instanceof Error ? error.message : "Could not approve.");
            }
        },
        [approveProposal, selectedCommitment]
    );

    const handleDismissProposal = useCallback(
        async (runId: Id<"agentRuns">) => {
            try {
                await dismissProposal({ runId });
                setStatusMessage("Dismissed — Jua will ask again later.");
            } catch {
                // dismissed proposal already resolved
            }
        },
        [dismissProposal]
    );

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
                        <Button
                            label={showPledge ? "Close" : "New pledge"}
                            variant="ghost"
                            onPress={() => setShowPledge((v) => !v)}
                        />
                    </View>
                    {hideBrand ? (
                        <Text style={styles.bridge}>Deals = act · Ledger = public proof</Text>
                    ) : null}
                    {statusMessage ? <Text style={styles.status}>{statusMessage}</Text> : null}
                </View>

                {!empty ? (
                    <AgentPresence
                        presence={data.agentPresence}
                        nextDigestAt={selectedCommitment?.nextDigestAt ?? null}
                        working={liveInbound != null || agentPhase === "acting"}
                    />
                ) : null}

                {(() => {
                    const proposal = selectedCommitment?.openProposal ?? null;
                    if (proposal) {
                        return (
                            <AuthRequiredGate required={requireAuthToAct}>
                                <ProposalCard
                                    ventureName={selectedCommitment!.venture.name}
                                    proposal={proposal}
                                    busy={agentPhase === "acting"}
                                    onApprove={() => void handleApproveProposal(proposal.id)}
                                    onDismiss={() => void handleDismissProposal(proposal.id)}
                                />
                            </AuthRequiredGate>
                        );
                    }
                    if (!empty && selectedCommitment) {
                        return (
                            <AgentArrival
                                inbound={liveInbound}
                                latestDigest={selectedCommitment.latestDigest}
                                dealCount={data.commitments.length}
                            />
                        );
                    }
                    return null;
                })()}

                {onDismissCoach ? (
                    <HowItWorksCard
                        visible={showCoach}
                        onDismiss={onDismissCoach}
                        onOpenGlossary={onOpenGlossary ? () => onOpenGlossary() : undefined}
                        compact={compact}
                    />
                ) : null}

                {showPledge ? (
                    <AuthRequiredGate required={requireAuthToAct}>
                    <Animated.View entering={FadeInDown.duration(180)}>
                        <Card>
                            <View style={styles.chipRow}>
                                {data.availableVentures.map((venture) => (
                                    <Chip
                                        key={venture.id}
                                        label={venture.name}
                                        active={selectedVenture?.id === venture.id}
                                        onPress={() => setSelectedVentureId(venture.id)}
                                    />
                                ))}
                            </View>
                            {data.availableVentures.length === 0 ? (
                                <Text style={styles.status}>No ventures yet — start a commitment from the landing.</Text>
                            ) : (
                                <Text style={styles.fieldHint}>Pick a venture · set a soft amount (intent only).</Text>
                            )}
                            <Input
                                value={amountText}
                                onChangeText={setAmountText}
                                keyboardType="number-pad"
                                placeholder="Amount in KES"
                            />
                            <Button
                                label={isPledging ? "…" : "Record soft pledge"}
                                onPress={handlePledge}
                                disabled={isPledging || !selectedVenture}
                                busy={isPledging}
                            />
                            {onOpenGlossary ? (
                                <Pressable onPress={() => onOpenGlossary("soft-pledge")}>
                                    <Text style={styles.inlineLink}>What is a soft pledge?</Text>
                                </Pressable>
                            ) : null}
                        </Card>
                    </Animated.View>
                    </AuthRequiredGate>
                ) : null}

                {empty ? (
                    <View style={styles.emptyCard}>
                        <View style={styles.emptyGlyph}>
                            <View style={styles.emptyRing} />
                            <View style={[styles.emptyRing, styles.emptyRingInner]} />
                        </View>
                        <Text style={styles.emptyTitle}>Nothing on my desk yet</Text>
                        <Text style={styles.status}>
                            Load seeded deals so Jua has something to follow — or pledge a venture.
                        </Text>
                        <Button
                            label="New pledge"
                            onPress={() => setShowPledge(true)}
                            disabled={data.availableVentures.length === 0}
                            style={styles.emptyBtn}
                        />
                        <Button
                            label={isSeeding ? "Loading…" : "Load seeded deals"}
                            variant="ghost"
                            onPress={handleSeed}
                            disabled={isSeeding}
                            busy={isSeeding}
                            style={styles.emptyBtn}
                        />
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
                                    activeRunId={activeRunId}
                                    inboundRun={inboundRun ?? null}
                                    onRunRunning={handleRunRunning}
                                    onRunCompleted={handleRunCompleted}
                                    onRunFailed={handleRunFailed}
                                    emailInbox={agentMail?.configured ? agentMail.inboxEmail ?? null : null}
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

/**
 * Presence line: Jua is visibly alive between visits — last worked, runs
 * this week, next digest countdown. All derived from real run/ledger data.
 * While a run is live, the mark breathes.
 */
function AgentPresence({
    presence,
    nextDigestAt,
    working,
}: {
    presence: Cockpit["agentPresence"];
    nextDigestAt: number | null;
    working: boolean;
}) {
    const parts: string[] = [];
    if (presence.lastWorkedAt) parts.push(`last worked ${relativeTime(presence.lastWorkedAt)}`);
    parts.push(presence.runsThisWeek === 1 ? "1 run this week" : `${presence.runsThisWeek} runs this week`);
    if (nextDigestAt && nextDigestAt > Date.now()) {
        const days = daysUntil(nextDigestAt);
        parts.push(days <= 1 ? "next digest tomorrow" : `next digest in ${days} days`);
    }

    return (
        <View style={styles.presence} accessibilityRole="text">
            {/* Static mark at rest; it breathes only while Jua is working. */}
            {working ? (
                <LivingSun progress={0.5} size={14} working />
            ) : (
                <SunMark size={14} />
            )}
            <Text style={styles.presenceText}>
                Jua · {parts.join(" · ")}
            </Text>
            {presence.openProposals > 0 ? (
                <View style={styles.presenceBadge}>
                    <Text style={styles.presenceBadgeText}>
                        {presence.openProposals} suggestion{presence.openProposals === 1 ? "" : "s"}
                    </Text>
                </View>
            ) : null}
        </View>
    );
}

/**
 * Jua's proactive proposal — suggested work parked for approval. Approving
 * runs the same durable pipeline; dismissing tells Jua to wait.
 */
function ProposalCard({
    ventureName,
    proposal,
    busy,
    onApprove,
    onDismiss,
}: {
    ventureName: string;
    proposal: NonNullable<Commitment["openProposal"]>;
    busy: boolean;
    onApprove: () => void;
    onDismiss: () => void;
}) {
    return (
        <Animated.View entering={FadeInDown.duration(180)}>
            <Card variant="trust" style={styles.proposal}>
                <View style={styles.cardTop}>
                    <View style={styles.titleWithHint}>
                        <SunMark size={16} />
                        <Text style={styles.cardTitle}>Jua suggests</Text>
                    </View>
                    <Text style={styles.meta}>proposed {relativeTime(proposal.createdAt)}</Text>
                </View>
                <Text style={styles.proposalBody}>{proposal.noteBody}</Text>
                <View style={styles.consequence}>
                    <Text style={styles.consequenceLabel}>If you approve, I will</Text>
                    {["Log a KPI check-in", "Write an investor digest", "Post to the public ledger", "Reply with evidence"].map(
                        (line) => (
                            <Text key={line} style={styles.consequenceLine}>
                                · {line}
                            </Text>
                        )
                    )}
                </View>
                <Button
                    label={busy ? "Starting…" : `Approve check-in on ${ventureName}`}
                    variant="approve"
                    onPress={onApprove}
                    disabled={busy}
                />
                <Pressable onPress={onDismiss} disabled={busy} hitSlop={6}>
                    <Text style={styles.discard}>Not now</Text>
                </Pressable>
            </Card>
        </Animated.View>
    );
}

/**
 * Arrival moment: the first thing on Home is Jua's latest utterance, not
 * metrics. Narrates live inbound runs; otherwise recites the last digest.
 * The one authored entrance on the screen — mark, voice, timestamp stagger in.
 */
function AgentArrival({
    inbound,
    latestDigest,
    dealCount,
}: {
    /** A live run that isn't ours (AgentMail) — thin status, no steps. */
    inbound: LatestRun | null;
    latestDigest: Commitment["latestDigest"];
    dealCount: number;
}) {
    const reduceMotion = useReducedMotion();

    let voice: string;
    if (inbound) {
        voice =
            inbound.trigger === "inbound_email"
                ? "I'm reading an email that just came in — live steps below."
                : "I'm working on a run right now — live steps below.";
    } else if (latestDigest) {
        voice = latestDigest.summary;
    } else if (dealCount > 0) {
        voice = `I'm watching ${dealCount} deal${dealCount === 1 ? "" : "s"}. Send me a note or email me, and I'll take it from there.`;
    } else {
        voice = "Nothing on my desk yet — pledge a venture and I'll start following it.";
    }

    const enter = (index: number) =>
        reduceMotion ? undefined : FadeInDown.duration(motion.base).delay(index * motion.stagger);

    return (
        <Card variant="trust" style={styles.arrival} accessibilityRole="text">
            <Animated.View entering={enter(0)}>
                <SunMark size={18} />
            </Animated.View>
            <Animated.View style={styles.arrivalBody} entering={enter(1)}>
                <Text style={styles.arrivalVoice}>{voice}</Text>
                {latestDigest && !inbound ? (
                    <Text style={styles.arrivalWhen}>{relativeTime(latestDigest.createdAt)}</Text>
                ) : null}
            </Animated.View>
        </Card>
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

    // Numbers with a point of view — derived from real data, not decoration.
    const commentary: string[] = [];
    if (typeof peer === "number" && peer > 0 && venture.kpiTotal !== peer) {
        const diff = Math.abs(venture.kpiTotal - peer);
        commentary.push(`${diff} ${venture.kpiTotal > peer ? "above" : "below"} similar ventures`);
    }
    if (venture.kpiTarget > 0) {
        commentary.push(`${Math.min(100, Math.round(progress * 100))}% of target`);
    }
    const lastCheckIn = commitment.recentCheckIns[0];
    if (lastCheckIn) commentary.push(`last check-in ${relativeTime(lastCheckIn.createdAt)}`);

    return (
        <Card>
            <View style={styles.cardTop}>
                <View style={styles.titleWithHint}>
                    <SunMark size={16} />
                    <Text style={styles.cardTitle} numberOfLines={1}>
                        {venture.name}
                    </Text>
                </View>
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
            {commentary.length > 0 ? (
                <Text style={styles.commentary}>{commentary.join(" · ")}</Text>
            ) : null}

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
                    <View style={styles.shareRowInner}>
                        <IconShare size={13} color={color.brassDeep} />
                        <Text style={styles.shareLink}>Share proof</Text>
                    </View>
                </Pressable>
            </View>

            {commitment.latestDigest ? (
                <Text style={styles.fieldHint}>Latest digest below.</Text>
            ) : (
                <Text style={styles.fieldHint}>No digest yet — approve a note below to generate one.</Text>
            )}
        </Card>
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
    // Plain figures — the shell stays calm; motion lives on the ritual.
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
    activeRunId,
    inboundRun,
    onRunRunning,
    onRunCompleted,
    onRunFailed,
    emailInbox,
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
    /** The run we approved (if any) — this card streams its steps. */
    activeRunId: Id<"agentRuns"> | null;
    /** Thin status line for the commitment's latest run (catches AgentMail). */
    inboundRun: LatestRun | null;
    onRunRunning: () => void;
    onRunCompleted: (message: string) => void;
    onRunFailed: (error: string) => void;
    emailInbox: string | null;
    onQueue: () => void;
    onApprove: () => void;
    onDiscard: () => void;
    onOpenLedger?: () => void;
    onOpenGlossary?: (focusId?: string) => void;
}) {
    const emails = commitment.recentEmails;
    const [showThread, setShowThread] = useState(false);
    const [actingSeconds, setActingSeconds] = useState(0);

    // The heavy per-step subscription lives here, inside the ritual card —
    // step commits re-render this card, not the whole cockpit.
    const ownRun = useQuery(
        api.agentRuns.getAgentRun,
        activeRunId ? { runId: activeRunId } : "skip"
    );
    const inboundRunId =
        inboundRun && inboundRun.id !== activeRunId && inboundRun.status === "running"
            ? inboundRun.id
            : null;
    const inboundDetail = useQuery(
        api.agentRuns.getAgentRun,
        inboundRunId ? { runId: inboundRunId } : "skip"
    );
    const liveRun = ownRun ?? inboundDetail ?? null;
    const runIsOurs = liveRun != null && ownRun != null && liveRun.id === activeRunId;
    const runLive = liveRun?.status === "running";
    const waiting = agentPhase === "queued" || (runLive && runIsOurs);
    const inboundActing = !runIsOurs && runLive && agentPhase !== "queued";
    const showApproveGate = pendingBody != null && agentPhase === "queued";
    const showSteps = liveRun != null && (runIsOurs || inboundActing);

    // Lifecycle for runs we own only — inbound runs never clobber root state.
    // Fires on status transitions, not per step.
    useEffect(() => {
        if (!liveRun || !runIsOurs) return;
        if (liveRun.status === "running") onRunRunning();
        else if (liveRun.status === "completed")
            onRunCompleted(liveRun.result?.message ?? "Agent run completed.");
        else if (liveRun.status === "failed") onRunFailed(liveRun.error ?? "Agent run failed.");
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

    // The ritual's sun answers the run: rays ignite as steps commit, full
    // corona at completion. At rest it's the quiet static mark.
    const steps = liveRun?.steps ?? [];
    const doneCount = steps.filter((step) => step.status === "done").length;
    const sunProgress =
        liveRun?.status === "completed"
            ? 1
            : steps.length > 0
              ? 0.3 + 0.7 * (doneCount / steps.length)
              : 0.35;

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
        <Card>
            <View style={styles.cardTop}>
                <View style={styles.titleWithHint}>
                    {liveRun ? (
                        <LivingSun progress={sunProgress} size={18} working={runLive} />
                    ) : (
                        <SunMark size={16} />
                    )}
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
                    : "Write a note, then approve to run."}
            </Text>

            <WaitingShimmer active={waiting} />

            {showSteps && liveRun ? (
                <RunSteps run={liveRun} onOpenLedger={onOpenLedger} />
            ) : null}

            {showApproveGate ? (
                <Animated.View entering={FadeInDown.duration(160)} style={styles.gate}>
                    <Text style={styles.gateEyebrow}>Ready to run</Text>
                    <Text style={styles.gateBody} numberOfLines={6}>
                        {pendingBody}
                    </Text>
                    <View style={styles.consequence}>
                        <Text style={styles.consequenceLabel}>Jua will</Text>
                        {["Log a KPI check-in", "Write an investor digest", "Post to the public ledger", "Reply with evidence"].map(
                            (line) => (
                                <Text key={line} style={styles.consequenceLine}>
                                    · {line}
                                </Text>
                            )
                        )}
                    </View>
                    <Button label="Approve & run" variant="approve" onPress={onApprove} />
                    <Pressable onPress={onDiscard} hitSlop={6}>
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
                    <Button
                        label="Send to agent"
                        onPress={onQueue}
                        icon={<IconSend size={14} color={color.paper} />}
                    />
                    {emailInbox ? (
                        <Text style={styles.emailAlt}>
                            Or email {emailInbox} — Jua reads it and runs the same steps.
                        </Text>
                    ) : null}
                </View>
            ) : null}

            {emails.length > 0 ? (
                <Pressable onPress={() => setShowThread((v) => !v)}>
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
        </Card>
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
                        <IconCheck size={11} color={color.success} strokeWidth={2.4} />
                    ) : step.status === "failed" ? (
                        <IconX size={10} color={color.danger} strokeWidth={2.4} />
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
        <Card variant="artifact">
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

            {/* The seal — proof this document was produced, not typed. */}
            <View style={styles.sealRow}>
                <SunMark size={11} />
                <Text style={styles.sealText}>Sealed by Jua · JuaKali agent</Text>
            </View>
        </Card>
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
    emptyBtn: { width: 260 },
    status: { fontFamily: font.body, fontSize: 12, color: color.brassDeep, textAlign: "center" },
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
    // Brass is the trust/permission color — the approve Button variant is the
    // only place it appears as a fill.
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
    stripAmt: { fontFamily: font.body, fontSize: 11, color: color.brass, fontVariant: tabularNums },
    stack: { gap: 12 },
    metrics: { flexDirection: "row", gap: 8 },
    metric: { flex: 1, padding: 10, borderRadius: 4, backgroundColor: color.stone, gap: 2 },
    metricValue: {
        fontFamily: font.display,
        fontSize: 22,
        fontWeight: "700",
        color: color.charcoal,
        letterSpacing: -0.4,
        fontVariant: tabularNums,
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
    // Presence line
    presence: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
    },
    presenceText: {
        fontFamily: font.body,
        fontSize: 12,
        color: color.mist,
        flexShrink: 1,
    },
    presenceBadge: {
        paddingHorizontal: 7,
        paddingVertical: 2,
        borderRadius: 4,
        backgroundColor: color.brassSoft,
        borderWidth: 1,
        borderColor: "rgba(166,124,45,0.25)",
    },
    presenceBadgeText: {
        fontFamily: font.bodyBold,
        fontSize: 10,
        fontWeight: "700",
        letterSpacing: 0.4,
        textTransform: "uppercase",
        color: color.brassDeep,
    },
    // Arrival moment — a trust card laid out as a voice line.
    arrival: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
        padding: 14,
    },
    arrivalBody: { flex: 1, gap: 2 },
    arrivalVoice: {
        fontFamily: font.bodyMedium,
        fontSize: 14,
        lineHeight: 20,
        color: color.ink,
    },
    arrivalWhen: {
        fontFamily: font.body,
        fontSize: 11,
        color: color.mist,
    },
    // Proposal card
    proposal: { gap: 10 },
    proposalBody: {
        fontFamily: font.body,
        fontSize: 14,
        lineHeight: 20,
        color: color.ink,
    },
    // Scorecard commentary
    commentary: {
        fontFamily: font.body,
        fontSize: 12,
        color: color.brassDeep,
        marginTop: 4,
    },
    shareRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
    },
    shareRowInner: { flexDirection: "row", alignItems: "center", gap: 5 },
    shareLink: {
        fontFamily: font.bodyBold,
        fontSize: 12,
        fontWeight: "700",
        color: color.brassDeep,
    },
    sparkTrack: { height: 34, justifyContent: "center" },
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
    // The digest seal — the artifact's signature line.
    sealRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        justifyContent: "center",
        paddingTop: 2,
    },
    sealText: {
        fontFamily: font.bodyMedium,
        fontSize: 10,
        letterSpacing: 0.5,
        textTransform: "uppercase",
        color: color.mist,
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
    emailAlt: {
        fontFamily: font.body,
        fontSize: 11,
        lineHeight: 16,
        color: color.mist,
    },
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
