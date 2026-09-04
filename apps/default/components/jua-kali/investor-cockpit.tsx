import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    AccessibilityInfo,
    ActivityIndicator,
    Platform,
    Pressable,
    ScrollView,
    Share,
    Text,
    TextInput,
    useWindowDimensions,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
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
import { useProductMode } from "@/lib/product-mode";
import { daysUntil, formatDueLabel, formatKes, relativeTime } from "@/components/jua-kali/cockpit/format";
import { DealsEmptyDesk } from "@/components/jua-kali/cockpit/deals-empty-desk";
import { Sparkline } from "@/components/jua-kali/cockpit/sparkline";
import { styles } from "@/components/jua-kali/cockpit/investor-cockpit.styles";
import { SITE_URL } from "@/lib/site";
import { HowItWorksCard, TermHint } from "@/components/jua-kali/help";
import { successHaptic, tapHaptic } from "@/components/jua-kali/haptics";
import { AuthRequiredGate } from "@/components/jua-kali/soft-identity";
import { SunMark } from "@/components/jua-kali/sun-mark";
import { LivingSun } from "@/components/jua-kali/living-sun";
import { useUiMotion } from "@/components/jua-kali/hooks/use-ui-motion";
import { IconCheck, IconSend, IconShare, IconX } from "@/components/jua-kali/icons";
import { Button, Card, Chip, Input } from "@/components/jua-kali/ui";
import { ShareWisdomCard, WisdomItemCard } from "@/components/jua-kali/wisdom";
import { useInvestorSession } from "@/components/jua-kali/investor-session";
import { color, layout } from "@/components/jua-kali/theme";

type Cockpit = FunctionReturnType<typeof api.invest.investorCockpit>;
type Commitment = Cockpit["commitments"][number];
type AgentRun = NonNullable<FunctionReturnType<typeof api.agentRuns.getAgentRun>>;
type LatestRun = NonNullable<FunctionReturnType<typeof api.agentRuns.getLatestRun>>;
type RunStep = AgentRun["steps"][number];
type AgentPhase = "idle" | "queued" | "acting" | "done" | "failed";
/** Structural shape RunSteps needs — real runs and the optimistic preview both fit. */
type RunLike = Pick<AgentRun, "status" | "steps" | "result" | "error">;

/** One-tap notes for mobile — the fastest path from open deal to working agent. */
const PROMPTS: Array<{ label: string; value: string }> = [
    { label: "Push follow-ups", value: "Push follow-ups this week. Reply with what moved." },
    { label: "Request evidence", value: "Ask for photos or a short note proving this week's work." },
    { label: "KPI status", value: "How is the KPI trending vs target? Summarize briefly." },
];

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
    initialVentureSlug,
    showCoach = false,
    onDismissCoach,
    onOpenGlossary,
    hideBrand = false,
    requireAuthToAct = false,
    onOpenLedger,
    onOpenDeal,
    dealsOnly = false,
    focusSingleDeal = false,
}: {
    initialCommitmentId?: Id<"commitments">;
    /** Venture slug deep-link target (works on native + web). */
    initialVentureSlug?: string;
    showCoach?: boolean;
    onDismissCoach?: () => void;
    onOpenGlossary?: (focusId?: string) => void;
    hideBrand?: boolean;
    requireAuthToAct?: boolean;
    onOpenLedger?: () => void;
    onOpenDeal?: (dealId: Id<"commitments">) => void;
    /** Portfolio surface without Today briefing chrome. */
    dealsOnly?: boolean;
    /** Hide deal strip; lock to initialCommitmentId. */
    focusSingleDeal?: boolean;
} = {}) {
    const dealParams = useMemo(() => {
        const fromUrl = readDealParams();
        return {
            commitmentId: initialCommitmentId ?? fromUrl.commitmentId,
            ventureSlug: initialVentureSlug ?? fromUrl.ventureSlug,
        };
    }, [initialCommitmentId, initialVentureSlug]);

    const data = useQuery(api.invest.investorCockpit, {
        commitmentId: dealParams.commitmentId,
        ventureSlug: dealParams.ventureSlug,
    });
    const { isAuthenticated } = useConvexAuth();
    const me = useQuery(api.softAuth.whoAmI);
    const product = useProductMode();
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
    const ui = useUiMotion();

    // Cross-route continuity: selected deal, per-deal drafts, and the active
    // run live in the InvestorSessionProvider (above the root Stack), so the
    // Deals tab, deal detail, and run/approval routes share one state.
    const session = useInvestorSession();

    const [localSelectedCommitmentId, setLocalSelectedCommitmentId] = useState<
        Id<"commitments"> | null
    >(dealParams.commitmentId ?? null);
    // Prefer the session's selection; fall back to this route's param.
    const selectedCommitmentId = session.selectedCommitmentId ?? localSelectedCommitmentId;
    const setSelectedCommitmentId = (id: Id<"commitments"> | null) => {
        setLocalSelectedCommitmentId(id);
        session.setSelectedCommitmentId(id);
    };

    const [selectedVentureId, setSelectedVentureId] = useState<Id<"ventures"> | null>(null);
    const [amountText, setAmountText] = useState("10000");

    // Per-commitment draft from the session (survives navigation).
    const draftKey = selectedCommitmentId ?? "";
    const emailDraft =
        session.draftByCommitment[draftKey] ??
        "Push follow-ups this week. Reply with what moved.";
    const setEmailDraft = useCallback(
        (value: string) => {
            if (selectedCommitmentId) session.setDraft(selectedCommitmentId, value);
        },
        [selectedCommitmentId, session]
    );

    const [pendingBody, setPendingBody] = useState<string | null>(null);
    const [agentPhase, setAgentPhase] = useState<AgentPhase>("idle");
    // Active run lives in the session so run/approval routes can read it.
    const activeRunId = session.activeRunId;
    const setActiveRunId = session.setActiveRunId;
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
        if (selectedCommitmentId == null) {
            setSelectedCommitmentId(data.focusCommitmentId);
        }
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
    const handleRunCompleted = useCallback(
        (message: string) => {
            setAgentPhase("done");
            setPendingBody(null);
            setEmailDraft("");
            setStatusMessage(message);
            successHaptic();
            void AccessibilityInfo.announceForAccessibility("Done. Digest and ledger updated.");
        },
        [setEmailDraft]
    );
    const handleRunFailed = useCallback((error: string) => {
        setAgentPhase("failed");
        setStatusMessage(error);
    }, []);

    // When a run starts, bring the ritual to the investor — approval shouldn't
    // hunt for its consequence below the fold.
    const scrollRef = useRef<ScrollView>(null);
    const ritualTop = useRef(0);
    useEffect(() => {
        if (agentPhase !== "acting") return;
        const timer = setTimeout(() => {
            scrollRef.current?.scrollTo({ y: Math.max(0, ritualTop.current - 12), animated: true });
        }, 200);
        return () => clearTimeout(timer);
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

    /** From the empty-desk gallery: pre-select the venture, open the pledge
     *  form, and scroll it into view so the investor lands on the form. */
    function handlePledgeVenture(ventureId: Id<"ventures">) {
        setSelectedVentureId(ventureId);
        setShowPledge(true);
        // Bring the pledge form into view on the next paint.
        requestAnimationFrame(() => {
            scrollRef.current?.scrollTo({ y: 0, animated: true });
        });
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
                ref={scrollRef}
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
                        <Text style={styles.bridge}>Deals = act · Proof = public record</Text>
                    ) : null}
                    {statusMessage ? <Text style={styles.status}>{statusMessage}</Text> : null}
                </View>

                {!dealsOnly && !empty ? (
                    <AgentPresence
                        presence={data.agentPresence}
                        nextDigestAt={selectedCommitment?.nextDigestAt ?? null}
                        working={liveInbound != null || agentPhase === "acting"}
                    />
                ) : null}

                {!dealsOnly
                    ? (() => {
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
                      })()
                    : null}

                {showPledge ? (
                    <AuthRequiredGate required={requireAuthToAct}>
                    <Animated.View entering={ui.down(180)}>
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
                    <DealsEmptyDesk
                        ventures={data.availableVentures}
                        demo={product.preset === "demo"}
                        isSeeding={isSeeding}
                        onSeed={handleSeed}
                        onPledgeVenture={handlePledgeVenture}
                        onOpenLedger={onOpenLedger}
                        onOpenGlossary={onOpenGlossary}
                    />
                ) : (
                    <>
                        {!focusSingleDeal ? (
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
                            {data.commitments.map((row) => {
                                const on = selectedCommitment?.id === row.id;
                                return (
                                    <Pressable
                                        key={row.id}
                                        onPress={() => {
                                            setSelectedCommitmentId(row.id);
                                            onOpenDeal?.(row.id);
                                        }}
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
                        ) : null}

                        {selectedCommitment ? (
                            <View style={styles.stack}>
                                {/* The action leads: note-to-Jua first, proof
                                    second, teaching one tap away at the bottom. */}
                                <View
                                    onLayout={(event) => {
                                        ritualTop.current = event.nativeEvent.layout.y;
                                    }}
                                >
                                    <AuthRequiredGate required={requireAuthToAct}>
                                    <Ritual
                                        compact={compact}
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
                                </View>
                                <Scorecard
                                    commitment={selectedCommitment}
                                    onOpenGlossary={onOpenGlossary}
                                />
                                <WisdomForCommitment
                                    ventureId={selectedCommitment.venture.id}
                                    ventureName={selectedCommitment.venture.name}
                                />
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

                {onDismissCoach ? (
                    <HowItWorksCard
                        visible={showCoach}
                        onDismiss={onDismissCoach}
                        onOpenGlossary={onOpenGlossary ? () => onOpenGlossary() : undefined}
                        compact={compact}
                    />
                ) : null}
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
    const { down } = useUiMotion();
    return (
        <Animated.View entering={down(180)}>
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
    const { enter } = useUiMotion();

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
    compact,
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
    compact: boolean;
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
    const { down } = useUiMotion();

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

    // The approval is in flight but Convex hasn't confirmed the run yet —
    // render the promised steps as queued chips so the moment has no gap.
    const optimistic = agentPhase === "acting" && liveRun == null;

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

    // A tick per committed step — the run is felt, not just watched.
    const prevDone = useRef(0);
    useEffect(() => {
        if (!liveRun || liveRun.status !== "running") {
            prevDone.current = 0;
            return;
        }
        if (doneCount > prevDone.current) tapHaptic();
        prevDone.current = doneCount;
    }, [doneCount, liveRun]);

    // Ceremony: on mobile, our run takes the card over — big sun, large
    // steps, one card to watch. Inbound runs and web keep the compact form.
    const ceremony = compact && (optimistic || (liveRun != null && runIsOurs));

    // What RunSteps renders while the real run is being created.
    const optimisticRun: RunLike | null = optimistic
        ? {
              status: "running",
              result: null,
              error: null,
              steps: [
                  "KPI check-in",
                  "Investor digest",
                  "Public ledger post",
                  "Reply with evidence",
              ].map((label) => ({ tool: label, label, detail: null, status: "pending" as const })),
          }
        : null;

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

    const ceremonyHeadline = optimistic
        ? "Starting the run…"
        : liveRun?.status === "completed"
          ? "Done — posted to Ledger"
          : liveRun?.status === "failed"
            ? "Run failed"
            : runLive
              ? "Jua is working"
              : "Note to Jua";

    return (
        <Card
            variant={ceremony ? "trust" : "default"}
            style={ceremony ? styles.ceremonyCard : undefined}
        >
            {ceremony ? (
                <View style={styles.ceremonyHead}>
                    <LivingSun progress={sunProgress} size={56} working={runLive || optimistic} />
                    <Text style={styles.ceremonyTitle}>{ceremonyHeadline}</Text>
                    {optimistic || runLive || liveRun?.status === "failed" ? (
                        <Text style={[styles.meta, liveRun?.status === "failed" && styles.metaDanger]}>
                            {optimistic
                                ? "Approving…"
                                : runLive
                                  ? phaseLabel
                                  : liveRun?.error ?? "The run did not complete."}
                        </Text>
                    ) : null}
                </View>
            ) : (
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
            )}

            <Text style={styles.fieldHint}>
                {inboundActing
                    ? "Jua is acting on an inbound email — live steps below."
                    : "Write a note, then approve to run."}
            </Text>

            <WaitingShimmer active={waiting} />

            {ceremony && (optimisticRun || liveRun) ? (
                <RunSteps run={(optimisticRun ?? liveRun)!} onOpenLedger={onOpenLedger} large />
            ) : showSteps && liveRun ? (
                <RunSteps run={liveRun} onOpenLedger={onOpenLedger} />
            ) : null}

            {showApproveGate ? (
                <Animated.View entering={down(160)} style={styles.gate}>
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
            ) : !runLive && !optimistic ? (
                <View style={styles.composer}>
                    {compact ? (
                        <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={styles.promptRow}
                        >
                            {PROMPTS.map((prompt) => (
                                <Chip
                                    key={prompt.label}
                                    label={prompt.label}
                                    active={draft === prompt.value}
                                    onPress={() => onChangeDraft(prompt.value)}
                                />
                            ))}
                        </ScrollView>
                    ) : null}
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

/**
 * The mentor's wisdom column for the selected deal: the share bar, then each
 * item living its life — read, proposed, applied with measured outcome.
 */
function WisdomForCommitment({ ventureId, ventureName }: { ventureId: string; ventureName: string }) {
    const items = useQuery(api.wisdom.wisdomForVenture, { ventureId: ventureId as never });
    if (items === undefined) return null;
    return (
        <View style={styles.stack}>
            <ShareWisdomCard ventureName={ventureName} ventureId={ventureId} />
            {items.length > 0 ? (
                <View style={styles.stack}>
                    {items.map((item) => (
                        <WisdomItemCard key={item.id} item={item} ventureName={ventureName} />
                    ))}
                </View>
            ) : null}
        </View>
    );
}

/** Live step chips driven by the real agentRun — nothing is simulated. */
function RunSteps({
    run,
    onOpenLedger,
    large = false,
}: {
    run: RunLike;
    onOpenLedger?: () => void;
    /** Ceremony sizing — big rows for the run-in-flight takeover. */
    large?: boolean;
}) {
    const failed = run.status === "failed";
    const done = run.status === "completed";
    return (
        <View style={[styles.toolRow, large && styles.toolRowLarge]} accessibilityLiveRegion="polite">
            {run.steps.map((step: RunStep) => (
                <View
                    key={step.tool}
                    style={[
                        styles.toolChip,
                        large && styles.toolChipLarge,
                        step.status === "running" && styles.toolChipRun,
                        step.status === "failed" && styles.toolChipFail,
                    ]}
                >
                    {step.status === "running" ? (
                        <ActivityIndicator size="small" color={color.brass} />
                    ) : step.status === "done" ? (
                        <IconCheck size={large ? 14 : 11} color={color.success} strokeWidth={2.4} />
                    ) : step.status === "failed" ? (
                        <IconX size={large ? 13 : 10} color={color.danger} strokeWidth={2.4} />
                    ) : (
                        <View style={[styles.toolDot, large && styles.toolDotLarge]} />
                    )}
                    <Text style={[styles.toolName, large && styles.toolNameLarge]} numberOfLines={1}>
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

