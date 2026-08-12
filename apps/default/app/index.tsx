import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AdminDashboard } from "@/components/jua-kali/admin-dashboard";
import { AgentChat } from "@/components/jua-kali/agent-chat";
import { InvestorCockpit } from "@/components/jua-kali/investor-cockpit";
import {
    InvestorLanding,
    useInvestorOnboardingGate,
} from "@/components/jua-kali/investor-onboarding";
import { Onboarding } from "@/components/jua-kali/onboarding";
import { PublicLedger } from "@/components/jua-kali/public-ledger";
import { color, font } from "@/components/jua-kali/theme";
import type { Id } from "@/convex/_generated/dataModel";

type Screen = "home" | "ledger" | "lab";
type LabScreen = "agent" | "funnel" | "ops";

const labTabs: Array<{ id: LabScreen; label: string }> = [
    { id: "agent", label: "Agent" },
    { id: "funnel", label: "Funnel" },
    { id: "ops", label: "Ops" },
];

/** Public demo hides Lab unless `?lab=1` (or native __DEV__). */
function useLabUnlocked() {
    const [unlocked, setUnlocked] = useState(() => {
        if (__DEV__ && Platform.OS !== "web") return true;
        return false;
    });

    useEffect(() => {
        if (Platform.OS !== "web" || typeof window === "undefined") return;
        const params = new URLSearchParams(window.location.search);
        if (params.get("lab") === "1") setUnlocked(true);
    }, []);

    return unlocked;
}

export default function Index() {
    const [screen, setScreen] = useState<Screen>("home");
    const [labScreen, setLabScreen] = useState<LabScreen>("agent");
    const [focusCommitmentId, setFocusCommitmentId] = useState<Id<"commitments"> | undefined>(() => {
        if (Platform.OS !== "web" || typeof window === "undefined") return undefined;
        const c = new URLSearchParams(window.location.search).get("c");
        return c ? (c as Id<"commitments">) : undefined;
    });
    const insets = useSafeAreaInsets();
    const onboarding = useInvestorOnboardingGate();
    const labUnlocked = useLabUnlocked();

    const hasDealLink = useMemo(() => {
        if (focusCommitmentId) return true;
        if (Platform.OS !== "web" || typeof window === "undefined") return false;
        return Boolean(new URLSearchParams(window.location.search).get("v"));
    }, [focusCommitmentId]);

    const primaryTabs = useMemo(() => {
        const tabs: Array<{ id: Screen; label: string }> = [
            { id: "home", label: "Home" },
            { id: "ledger", label: "Ledger" },
        ];
        if (labUnlocked) tabs.push({ id: "lab", label: "Lab" });
        return tabs;
    }, [labUnlocked]);

    useEffect(() => {
        if (!labUnlocked && screen === "lab") setScreen("home");
    }, [labUnlocked, screen]);

    useEffect(() => {
        if (onboarding.show && hasDealLink) {
            void onboarding.complete();
        }
    }, [onboarding.show, onboarding.complete, hasDealLink]);

    if (!onboarding.ready) {
        return (
            <View style={styles.boot}>
                <ActivityIndicator color={color.brass} />
            </View>
        );
    }

    if (onboarding.show && !hasDealLink) {
        return (
            <InvestorLanding
                onEnter={(opts) => {
                    if (opts?.commitmentId) setFocusCommitmentId(opts.commitmentId);
                    void onboarding.complete();
                }}
            />
        );
    }

    return (
        <View style={styles.container}>
            <View style={styles.content}>
                {screen === "home" ? (
                    <InvestorCockpit initialCommitmentId={focusCommitmentId} />
                ) : screen === "ledger" ? (
                    <PublicLedger />
                ) : labScreen === "agent" ? (
                    <AgentChat />
                ) : labScreen === "funnel" ? (
                    <Onboarding onEnterDashboard={() => setLabScreen("ops")} />
                ) : (
                    <AdminDashboard />
                )}
            </View>
            <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
                <View style={styles.tabRow}>
                    {primaryTabs.map((tab) => (
                        <TabButton
                            key={tab.id}
                            label={tab.label}
                            active={screen === tab.id}
                            onPress={() => setScreen(tab.id)}
                        />
                    ))}
                </View>
                {screen === "lab" && labUnlocked ? (
                    <View style={styles.labRow}>
                        {labTabs.map((tab) => (
                            <TabButton
                                key={tab.id}
                                label={tab.label}
                                active={labScreen === tab.id}
                                onPress={() => setLabScreen(tab.id)}
                                compact
                            />
                        ))}
                    </View>
                ) : null}
            </View>
        </View>
    );
}

function TabButton({
    label,
    active,
    onPress,
    compact,
}: {
    label: string;
    active: boolean;
    onPress: () => void;
    compact?: boolean;
}) {
    return (
        <Pressable
            onPress={onPress}
            style={[styles.tab, compact && styles.tabCompact, active && styles.tabActive]}
        >
            <Text style={[styles.tabText, compact && styles.tabTextCompact, active && styles.tabTextActive]}>
                {label}
            </Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    boot: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: color.stone },
    container: { flex: 1, backgroundColor: color.stone },
    content: { flex: 1 },
    tabBar: {
        borderTopWidth: 1,
        borderTopColor: color.line,
        backgroundColor: color.paper,
    },
    tabRow: {
        flexDirection: "row",
        justifyContent: "center",
        maxWidth: 880,
        width: "100%",
        alignSelf: "center",
        paddingHorizontal: 8,
    },
    labRow: {
        flexDirection: "row",
        justifyContent: "center",
        gap: 4,
        paddingHorizontal: 12,
        paddingTop: 2,
    },
    tab: {
        flex: 1,
        maxWidth: 160,
        paddingVertical: 14,
        alignItems: "center",
        minHeight: 48,
        justifyContent: "center",
    },
    tabCompact: {
        flex: 0,
        paddingHorizontal: 14,
        paddingVertical: 8,
        minHeight: 36,
    },
    tabActive: {
        borderTopWidth: 2,
        borderTopColor: color.brass,
    },
    tabText: {
        fontFamily: font.bodyBold,
        color: color.mist,
        fontSize: 13,
        fontWeight: "700",
        letterSpacing: 0.3,
    },
    tabTextCompact: { fontSize: 11 },
    tabTextActive: { color: color.charcoal },
});
