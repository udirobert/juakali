import { useMemo } from "react";
import {
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "convex/react";
import { useRouter } from "expo-router";

import { api } from "@/convex/_generated/api";
import { Approval, PublicationApproval, type ActionPlanView } from "@/components/jua-kali/approval";
import { DigestBento } from "@/components/jua-kali/digest-bento";
import { JuaWire } from "@/components/jua-kali/jua-wire";
import { HowItWorksCard } from "@/components/jua-kali/help";
import type { AgentSunState } from "@/components/jua-kali/living-sun";
import { AuthRequiredGate } from "@/components/jua-kali/soft-identity";
import { TodaySkeleton } from "@/components/jua-kali/loaders/today-skeleton";
import { TodayDayZero } from "@/components/jua-kali/today-day-zero";
import { SectionLabel } from "@/components/jua-kali/ui";
import { useUiMotion } from "@/components/jua-kali/hooks/use-ui-motion";
import { color, font, layout, space, type } from "@/components/jua-kali/theme";
import { relativeTime } from "@/components/jua-kali/cockpit/format";

export function TodayBriefing({
    showCoach = false,
    onDismissCoach,
    onOpenGlossary,
    hideBrand = false,
}: {
    showCoach?: boolean;
    onDismissCoach?: () => void;
    onOpenGlossary?: (focusId?: string) => void;
    hideBrand?: boolean;
} = {}) {
    const briefing = useQuery(api.invest.todayBriefing, {});
    const activity = useQuery(api.agentRuns.activityForInvestor, {});
    const insets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    const padX = Math.max(16, Math.min(32, (width - layout.maxWidth) / 2 + 20));
    const router = useRouter();

    const agentState = useMemo(() => {
        if (!briefing) return "observing" as const;
        if (briefing.stats.blocked > 0) return "blocked" as const;
        if (briefing.decision) return "proposing" as const;
        if ((activity?.active.length ?? 0) > 0) return "executing" as const;
        if (briefing.completed.length > 0 || briefing.digests.length > 0) return "verified" as const;
        return "observing" as const;
    }, [briefing, activity]);

    const { fade } = useUiMotion();

    if (briefing === undefined || !activity) {
        return <TodaySkeleton />;
    }

    const decision = briefing.decision as ActionPlanView | null;
    const failedRuns = activity?.failed ?? [];

    const hasActivity = Boolean(
        activity &&
            (activity.active.length > 0 ||
                activity.waiting.length > 0 ||
                activity.blocked.length > 0)
    );
    const dayZero =
        !decision &&
        !briefing.publication &&
        failedRuns.length === 0 &&
        briefing.completed.length === 0 &&
        briefing.digests.length === 0 &&
        !briefing.nextScheduled &&
        !hasActivity;

    return (
        <ScrollView
            contentContainerStyle={[
                styles.scroll,
                { paddingTop: insets.top + (hideBrand ? 10 : 20), paddingHorizontal: padX },
                dayZero && width >= 700 && { flexGrow: 1, justifyContent: "center" },
            ]}
            showsVerticalScrollIndicator={false}
        >
            <Animated.View entering={fade()} style={styles.frame}>
                {!hideBrand ? (
                    <View style={[styles.brandRow, dayZero && styles.brandRowDayZero]}>
                        <Text style={styles.brand}>JuaKali</Text>
                        <Pressable
                            onPress={() => router.push("/account")}
                            hitSlop={10}
                            accessibilityRole="button"
                            accessibilityLabel="Account"
                        >
                            <Text style={styles.accountLink}>Account</Text>
                        </Pressable>
                    </View>
                ) : (
                    <View style={[styles.brandRow, dayZero && styles.brandRowDayZero]}>
                        <View />
                        <Pressable
                            onPress={() => router.push("/account")}
                            hitSlop={10}
                            accessibilityRole="button"
                            accessibilityLabel="Account"
                        >
                            <Text style={styles.accountLink}>Account</Text>
                        </Pressable>
                    </View>
                )}

                {dayZero ? (
                    <TodayDayZero
                        greetingName={briefing.greetingName}
                        briefingText={briefing.briefingText}
                    />
                ) : (
                    <>
                        <View style={styles.heroEditorial}>
                            <Text style={styles.greeting}>
                                {briefing.greetingName
                                    ? `Good day, ${briefing.greetingName}`
                                    : "Good day"}
                            </Text>
                            <Text style={styles.briefing}>{briefing.briefingText}</Text>
                            <JuaWire
                                agentState={agentState}
                                line={wireLineForToday(agentState, {
                                    decisionVenture: decision?.ventureName ?? null,
                                    publicationVenture: briefing.publication?.ventureName ?? null,
                                    activeCount: activity?.active.length ?? 0,
                                    digestCount: briefing.digests.length,
                                })}
                                meta={wireMetaForToday({
                                    venturesMoved: briefing.stats.venturesMoved,
                                    nextScheduled: briefing.nextScheduled,
                                    digests: briefing.digests.length,
                                })}
                            />
                        </View>

                        <HowItWorksCard
                            visible={showCoach}
                            onDismiss={() => onDismissCoach?.()}
                            onOpenGlossary={() => onOpenGlossary?.()}
                        />

                        {decision ? (
                            <View style={styles.block}>
                                <AuthRequiredGate
                                    required
                                    message="Sign in to approve Jua's suggestion — runs only happen on deals you own."
                                >
                                    <Approval.Provider plan={decision}>
                                        <Approval.Card>
                                            <Approval.Preview />
                                            <Approval.Actions
                                                onApproved={(runId) => router.push(`/runs/${runId}`)}
                                                onDismissed={() => undefined}
                                            />
                                        </Approval.Card>
                                    </Approval.Provider>
                                </AuthRequiredGate>
                            </View>
                        ) : null}

                        {briefing.publication ? (
                            <View style={styles.block}>
                                <AuthRequiredGate
                                    required
                                    message="Sign in to approve publication — proof only goes public with your say-so."
                                >
                                    <PublicationApproval
                                        publication={briefing.publication}
                                        onPublished={(runId) => router.push(`/runs/${runId}`)}
                                    />
                                </AuthRequiredGate>
                            </View>
                        ) : null}

                        {failedRuns.map((failed) => (
                            <View key={failed.id} style={styles.block}>
                                <AuthRequiredGate required>
                                    <Approval.Recovery
                                        runId={failed.id}
                                        error={failed.error ?? "This run failed."}
                                        onRetried={(runId) => router.push(`/runs/${runId}`)}
                                    />
                                </AuthRequiredGate>
                            </View>
                        ))}

                        {briefing.digests.length > 0 ? (
                            <View style={styles.block}>
                                <SectionLabel>Latest digests</SectionLabel>
                                <DigestBento
                                    digests={briefing.digests}
                                    onOpenLedger={() => router.push("/(tabs)/proof")}
                                    onOpenDeal={(commitmentId) =>
                                        router.push(`/(tabs)/deals?c=${commitmentId}`)
                                    }
                                />
                            </View>
                        ) : null}

                        {briefing.completed.length > 0 ? (
                            <View style={styles.block}>
                                <SectionLabel>Completed</SectionLabel>
                                <View style={styles.completedList}>
                                    {briefing.completed.map((item) => (
                                        <View
                                            key={`${item.at}-${item.title}`}
                                            style={styles.completedRow}
                                        >
                                            <Text style={styles.completedMark}>✓</Text>
                                            <View style={styles.completedCopy}>
                                                <Text style={styles.completedTitle}>{item.title}</Text>
                                                <Text style={styles.completedMeta}>
                                                    {relativeTime(item.at)}
                                                </Text>
                                            </View>
                                            {item.proofEventId ? (
                                                <Pressable
                                                    onPress={() =>
                                                        router.push(`/proof/${item.proofEventId}`)
                                                    }
                                                    hitSlop={8}
                                                >
                                                    <Text style={styles.link}>View proof</Text>
                                                </Pressable>
                                            ) : item.runId ? (
                                                <Pressable
                                                    onPress={() => router.push(`/runs/${item.runId}`)}
                                                    hitSlop={8}
                                                >
                                                    <Text style={styles.link}>View run</Text>
                                                </Pressable>
                                            ) : null}
                                        </View>
                                    ))}
                                </View>
                            </View>
                        ) : null}

                        {briefing.nextScheduled ? (
                            <View style={styles.block}>
                                <SectionLabel>Next scheduled</SectionLabel>
                                <View style={styles.nextCard}>
                                    <Text style={styles.nextLabel}>{briefing.nextScheduled.label}</Text>
                                    <Text style={styles.completedMeta}>
                                        {new Date(briefing.nextScheduled.at).toLocaleString(undefined, {
                                            weekday: "short",
                                            month: "short",
                                            day: "numeric",
                                            hour: "numeric",
                                            minute: "2-digit",
                                        })}
                                    </Text>
                                </View>
                            </View>
                        ) : null}

                        {activity &&
                        (activity.active.length > 0 ||
                            activity.waiting.length > 0 ||
                            activity.blocked.length > 1) ? (
                            <View style={styles.block}>
                                <SectionLabel>Agent activity</SectionLabel>
                                <View style={styles.activityList}>
                                    {activity.active.map((row) => (
                                        <Pressable
                                            key={row.id}
                                            onPress={() => router.push(`/runs/${row.id}`)}
                                            style={styles.activityRow}
                                        >
                                            <Text style={styles.activityTitle}>
                                                Running · {row.ventureName}
                                            </Text>
                                            <Text style={styles.link}>Open</Text>
                                        </Pressable>
                                    ))}
                                    {activity.waiting.map((row) => (
                                        <Pressable
                                            key={row.id}
                                            onPress={() => router.push(`/runs/${row.id}`)}
                                            style={styles.activityRow}
                                        >
                                            <Text style={styles.activityTitle}>
                                                Waiting on founder · {row.ventureName}
                                            </Text>
                                            <Text style={styles.link}>Open</Text>
                                        </Pressable>
                                    ))}
                                    {activity.blocked.slice(decision ? 1 : 0).map((row) => (
                                        <Pressable
                                            key={row.id}
                                            onPress={() => router.push(`/approvals/${row.id}`)}
                                            style={styles.activityRow}
                                        >
                                            <Text style={styles.activityTitle}>
                                                {row.status === "awaiting_publication"
                                                    ? `Approve publication · ${row.ventureName}`
                                                    : `Needs decision · ${row.ventureName}`}
                                            </Text>
                                            <Text style={styles.link}>Review</Text>
                                        </Pressable>
                                    ))}
                                </View>
                            </View>
                        ) : null}

                        <Pressable
                            onPress={() => router.push("/(tabs)/deals")}
                            style={styles.dealsCta}
                            accessibilityRole="button"
                        >
                            <Text style={styles.dealsCtaText}>Browse deals →</Text>
                        </Pressable>
                    </>
                )}
            </Animated.View>
        </ScrollView>
    );
}

function wireLineForToday(
    state: AgentSunState,
    ctx: {
        decisionVenture: string | null;
        publicationVenture: string | null;
        activeCount: number;
        digestCount: number;
    }
): string {
    if (state === "proposing" && ctx.decisionVenture) {
        return `I have a move ready on ${ctx.decisionVenture}. Seal it and I'll run.`;
    }
    if (state === "proposing" && ctx.publicationVenture) {
        return `Evidence landed for ${ctx.publicationVenture}. Your seal publishes it.`;
    }
    if (state === "executing") {
        return ctx.activeCount > 1
            ? `I'm mid-run on ${ctx.activeCount} deals — proof will land when each seals.`
            : "I'm mid-run right now — you'll see the ledger tick when it seals.";
    }
    if (state === "blocked") {
        return "A run stalled. Retry or dismiss — I won't invent a path past your say-so.";
    }
    if (state === "verified") {
        return ctx.digestCount > 0
            ? "Latest work is sealed. Digests below are the paper trail."
            : "Quiet after a seal — I'm watching for the next honest move.";
    }
    return "I'm on the wire — watching pledges, digests, and anything that needs you.";
}

function wireMetaForToday(args: {
    venturesMoved: number;
    nextScheduled: { label: string; at: number } | null;
    digests: number;
}): string {
    const parts: string[] = [];
    if (args.venturesMoved > 0) {
        parts.push(
            args.venturesMoved === 1 ? "1 venture moved" : `${args.venturesMoved} ventures moved`
        );
    }
    if (args.digests > 0) {
        parts.push(args.digests === 1 ? "1 digest ready" : `${args.digests} digests ready`);
    }
    if (args.nextScheduled) {
        parts.push(args.nextScheduled.label);
    }
    return parts.length > 0 ? parts.join(" · ") : "desk live";
}

const styles = StyleSheet.create({
    scroll: { paddingBottom: 88 },
    // Wider breathing between Today blocks — MengTo rhythm, not a dense stack.
    frame: {
        maxWidth: layout.maxWidth,
        width: "100%",
        alignSelf: "center",
        gap: space[6],
    },
    brandRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
    },
    brandRowDayZero: { maxWidth: 560, width: "100%", alignSelf: "center" },
    brand: {
        fontFamily: font.display,
        fontSize: 28,
        fontWeight: "700",
        color: color.charcoal,
        letterSpacing: -0.6,
    },
    accountLink: {
        fontFamily: font.bodyBold,
        fontSize: 13,
        color: color.brassDeep,
    },
    // Filled desk: greeting as editorial lead, then the Wire as living instrument.
    heroEditorial: { gap: space[4] },
    greeting: {
        fontFamily: font.display,
        fontSize: 34,
        fontWeight: "700",
        letterSpacing: -1,
        lineHeight: 40,
        color: color.charcoal,
    },
    briefing: { ...type.body, fontSize: 17, lineHeight: 26, color: color.mist, maxWidth: 520 },
    block: { gap: space[3] },
    completedList: { gap: 2 },
    completedRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
        paddingVertical: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: color.line,
    },
    completedMark: { color: color.success, fontSize: 16, marginTop: 2 },
    completedCopy: { flex: 1, gap: 2 },
    completedTitle: { ...type.body, fontSize: 15, lineHeight: 22 },
    completedMeta: { ...type.meta, fontSize: 12 },
    nextCard: {
        gap: 6,
        padding: space[4],
        borderRadius: 10,
        backgroundColor: color.paper,
        borderWidth: 1,
        borderColor: color.line,
    },
    nextLabel: { ...type.body, fontSize: 15 },
    link: {
        fontFamily: font.bodyBold,
        fontSize: 13,
        color: color.brassDeep,
    },
    activityList: { gap: 0 },
    activityRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: color.line,
    },
    activityTitle: { ...type.body, fontSize: 14, flex: 1 },
    dealsCta: { paddingVertical: space[3], marginTop: space[2] },
    dealsCtaText: {
        fontFamily: font.bodyBold,
        color: color.mist,
        fontSize: 14,
    },
});
