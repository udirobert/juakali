import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AdminDashboard } from "@/components/jua-kali/admin-dashboard";
import { Onboarding } from "@/components/jua-kali/onboarding";
import { AgentChat } from "@/components/jua-kali/agent-chat";

type Screen = "onboarding" | "agent" | "admin";

const palette = {
    terracotta: "#E07A5F",
    olive: "#3B4D3B",
    cream: "#F5F1E8",
};

export default function Index() {
    const [screen, setScreen] = useState<Screen>("onboarding");

    return (
        <View style={styles.container}>
            <View style={styles.content}>
                {screen === "onboarding" ? (
                    <Onboarding onEnterDashboard={() => setScreen("admin")} />
                ) : screen === "agent" ? (
                    <AgentChat />
                ) : (
                    <AdminDashboard />
                )}
            </View>
            <View style={styles.tabBar}>
                <TabButton
                    label="Onboarding"
                    active={screen === "onboarding"}
                    onPress={() => setScreen("onboarding")}
                />
                <TabButton
                    label="Agent Chat"
                    active={screen === "agent"}
                    onPress={() => setScreen("agent")}
                />
                <TabButton
                    label="Dashboard"
                    active={screen === "admin"}
                    onPress={() => setScreen("admin")}
                />
            </View>
        </View>
    );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
    return (
        <Pressable
            onPress={onPress}
            style={[styles.tab, active && styles.tabActive]}
        >
            <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: palette.cream },
    content: { flex: 1 },
    tabBar: {
        flexDirection: "row",
        borderTopWidth: 1,
        borderTopColor: "rgba(59,77,59,0.1)",
        backgroundColor: "rgba(245,241,232,0.95)",
        paddingBottom: 20,
    },
    tab: {
        flex: 1,
        paddingVertical: 12,
        alignItems: "center",
    },
    tabActive: {
        borderTopWidth: 2,
        borderTopColor: palette.terracotta,
    },
    tabText: {
        color: "rgba(36,49,36,0.5)",
        fontSize: 12,
        fontWeight: "700",
    },
    tabTextActive: {
        color: palette.olive,
    },
});
