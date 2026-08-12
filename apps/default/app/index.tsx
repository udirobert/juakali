import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AdminDashboard } from "@/components/jua-kali/admin-dashboard";
import { AgentChat } from "@/components/jua-kali/agent-chat";
import { InvestorCockpit } from "@/components/jua-kali/investor-cockpit";
import { Onboarding } from "@/components/jua-kali/onboarding";
import { PublicLedger } from "@/components/jua-kali/public-ledger";

type Screen = "home" | "ledger" | "lab";
type LabScreen = "agent" | "funnel" | "ops";

const palette = {
    terracotta: "#E07A5F",
    olive: "#3B4D3B",
    cream: "#F5F1E8",
};

const primaryTabs: Array<{ id: Screen; label: string }> = [
    { id: "home", label: "Home" },
    { id: "ledger", label: "Ledger" },
    { id: "lab", label: "Lab" },
];

const labTabs: Array<{ id: LabScreen; label: string }> = [
    { id: "agent", label: "Agent" },
    { id: "funnel", label: "Funnel" },
    { id: "ops", label: "Ops" },
];

export default function Index() {
    const [screen, setScreen] = useState<Screen>("home");
    const [labScreen, setLabScreen] = useState<LabScreen>("agent");
    const insets = useSafeAreaInsets();

    return (
        <View style={styles.container}>
            <View style={styles.content}>
                {screen === "home" ? (
                    <InvestorCockpit />
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
                {screen === "lab" ? (
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
    container: { flex: 1, backgroundColor: palette.cream },
    content: { flex: 1 },
    tabBar: {
        borderTopWidth: 1,
        borderTopColor: "rgba(59,77,59,0.1)",
        backgroundColor: "rgba(245,241,232,0.98)",
    },
    tabRow: {
        flexDirection: "row",
        justifyContent: "space-around",
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
        paddingVertical: 12,
        alignItems: "center",
        minHeight: 44,
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
        borderTopColor: palette.terracotta,
    },
    tabText: {
        color: "rgba(36,49,36,0.5)",
        fontSize: 13,
        fontWeight: "700",
    },
    tabTextCompact: {
        fontSize: 11,
    },
    tabTextActive: {
        color: palette.olive,
    },
});
