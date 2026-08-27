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
import { LivingSun } from "@/components/jua-kali/living-sun";
import { HowItWorksCard } from "@/components/jua-kali/help";
import { AuthRequiredGate, useRequireAuthToAct } from "@/components/jua-kali/soft-identity";
import { TodaySkeleton } from "@/components/jua-kali/loaders/today-skeleton";
import { SectionLabel } from "@/components/jua-kali/ui";
import { useUiMotion } from "@/components/jua-kali/hooks/use-ui-motion";
import { color, font, layout, type } from "@/components/jua-kali/theme";
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
    const requireAuthToAct = useRequireAuthToAct();
    const insets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    const padX = Math.max(14, Math.min(28, (width - layout.maxWidth) / 2 + 16));
    const router = useRouter();

    const agentState = useMemo(() => {
        if (!briefing) return "observing" as const;
        if (briefing.stats.blocked > 0) return "blocked" as const;
        if (briefing.decision) return "proposing" as const;
        if ((activity?.active.length ?? 0) > 0) return "executing" as const;
        if (briefing.completed.length > 0) return "verified" as const;
        return "observing" as const;
    }, [briefing, activity]);

    // Ease the skeleton → briefing swap — one fade, no layout shift.
    const { fade } = useUiMotion();

    if (briefing === undefined || !activity) {
        return <TodaySkeleton />;
    }

    const decision = briefing.decision as ActionPlanView | null;
    // Every unresolved failure, most recent first — each gets a recovery card.
    const failedRuns = activity?.failed ?? [];

    return (
        <ScrollView
            contentContainerStyle={[
                styles.scroll,
                { paddingTop: insets.top + (hideBrand ? 8 : 16), paddingHorizontal: padX },
            ]}
            showsVerticalScrollIndicator={false}
        >
            <Animated.View entering={fade()} style={styles.frame}>
                {!hideBrand ? (
                    <View style={styles.brandRow}>
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
                    <View style={styles.brandRow}>
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

                <View style={styles.hero}>
                    <LivingSun
                        size={56}
                        progress={
                            agentState === "observing"
                                ? 0.15
                                : agentState === "proposing"
                                  ? 0.45
                                  : agentState === "executing"
                                    ? 0.75
                                    : agentState === "verified"
                                      ? 1
                                      : 0.2
                        }
                        working={agentState === "executing"}
                        agentState={agentState}
                    />
                    <View style={styles.heroCopy}>
                        <Text style={styles.greeting}>
                            {briefing.greetingName
                                ? `Good day, ${briefing.greetingName}`
                                : "Good day"}
                        </Text>
                        <Text style={styles.briefing}>{briefing.briefingText}</Text>
                    </View>
                </View>

                <HowItWorksCard
                    visible={showCoach}
                    onDismiss={() => onDismissCoach?.()}
                    onOpenGlossary={() => onOpenGlossary?.()}
                />

                {decision ? (
                    <AuthRequiredGate required={requireAuthToAct}>
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
                ) : null}

                {briefing.publication ? (
                    <AuthRequiredGate required={requireAuthToAct}>
                        <PublicationApproval
                            publication={briefing.publication}
                            onPublished={(runId) => router.push(`/runs/${runId}`)}
                        />
                    </AuthRequiredGate>
                ) : null}

                {failedRuns.map((failed) => (
                    <AuthRequiredGate key={failed.id} required={requireAuthToAct}>
                        <Approval.Recovery
                            runId={failed.id}
                            error={failed.error ?? "This run failed."}
                            onRetried={(runId) => router.push(`/runs/${runId}`)}
                        />
                    </AuthRequiredGate>
                ))}

                {briefing.completed.length > 0 ? (
                    <View style={styles.section}>
                        <SectionLabel>Completed</SectionLabel>
                        {briefing.completed.map((item) => (
                            <View key={`${item.at}-${item.title}`} style={styles.completedRow}>
                                <Text style={styles.completedMark}>✓</Text>
                                <View style={styles.completedCopy}>
                                    <Text style={styles.completedTitle}>{item.title}</Text>
                                    <Text style={styles.completedMeta}>{relativeTime(item.at)}</Text>
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
                ) : null}

                {briefing.nextScheduled ? (
                    <View style={styles.section}>
                        <SectionLabel>Next scheduled action</SectionLabel>
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
                ) : null}

                {activity &&
                (activity.active.length > 0 ||
                    activity.waiting.length > 0 ||
                    activity.blocked.length > 1) ? (
                    <View style={styles.section}>
                        <SectionLabel>Agent activity</SectionLabel>
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
                                <Text style={styles.link}>
                                    {row.status === "awaiting_publication" ? "Review" : "Review"}
                                </Text>
                            </Pressable>
                        ))}
                    </View>
                ) : null}

                <Pressable
                    onPress={() => router.push("/(tabs)/deals")}
                    style={styles.dealsCta}
                    accessibilityRole="button"
                >
                    <Text style={styles.dealsCtaText}>Browse deals →</Text>
                </Pressable>
            </Animated.View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    scroll: { paddingBottom: 48 },
    frame: { maxWidth: layout.maxWidth, width: "100%", alignSelf: "center", gap: 20 },
    brandRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
    },
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
    hero: { flexDirection: "row", gap: 14, alignItems: "flex-start" },
    heroCopy: { flex: 1, gap: 8 },
    greeting: { ...type.title, fontSize: 26, lineHeight: 32 },
    briefing: { ...type.body, fontSize: 17, lineHeight: 26 },
    section: { gap: 10 },
    completedRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
        paddingVertical: 6,
    },
    completedMark: { color: color.success, fontSize: 16, marginTop: 2 },
    completedCopy: { flex: 1, gap: 2 },
    completedTitle: { ...type.body, fontSize: 15, lineHeight: 22 },
    completedMeta: { ...type.meta, fontSize: 12 },
    nextLabel: { ...type.body, fontSize: 15 },
    link: {
        fontFamily: font.bodyBold,
        fontSize: 13,
        color: color.brassDeep,
    },
    activityRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingVertical: 8,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: color.line,
    },
    activityTitle: { ...type.body, fontSize: 14, flex: 1 },
    dealsCta: { paddingVertical: 12 },
    dealsCtaText: {
        fontFamily: font.bodyBold,
        color: color.mist,
        fontSize: 14,
    },
});
