import { useState } from "react";
import { Platform, View } from "react-native";
import { Redirect } from "expo-router";

import { AdminDashboard } from "@/components/jua-kali/admin-dashboard";
import { AgentChat } from "@/components/jua-kali/agent-chat";
import { Onboarding } from "@/components/jua-kali/onboarding";
import { NavTabs, type LabTabId } from "@/components/jua-kali/shell/tabs";
import { color } from "@/components/jua-kali/theme";

function labUnlocked() {
    if (__DEV__ && Platform.OS !== "web") return true;
    if (Platform.OS === "web" && typeof window !== "undefined") {
        return new URLSearchParams(window.location.search).get("lab") === "1" || __DEV__;
    }
    return __DEV__;
}

export default function LabScreen() {
    const [labScreen, setLabScreen] = useState<LabTabId>("agent");
    if (!labUnlocked()) return <Redirect href="/(tabs)/today" />;

    return (
        <View style={{ flex: 1, backgroundColor: color.stone }}>
            <NavTabs
                primaryTabs={[{ id: "lab", label: "Lab" }]}
                activePrimary="lab"
                labActive={labScreen}
                showLab
                onSelectPrimary={() => undefined}
                onSelectLab={setLabScreen}
            />
            {labScreen === "agent" ? (
                <AgentChat />
            ) : labScreen === "funnel" ? (
                <Onboarding onEnterDashboard={() => setLabScreen("ops")} />
            ) : (
                <AdminDashboard />
            )}
        </View>
    );
}
