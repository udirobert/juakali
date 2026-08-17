import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useMutation, useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import { SoftIdentityBar, AuthRequiredGate, useRequireAuthToAct } from "@/components/jua-kali/soft-identity";
import { Button, SectionLabel } from "@/components/jua-kali/ui";
import { color, font, type } from "@/components/jua-kali/theme";

const LEVELS = [
    {
        id: "ask_every_time" as const,
        label: "Ask every time",
        body: "Jua proposes work; nothing consequential runs without your approve.",
    },
    {
        id: "auto_low_risk" as const,
        label: "Auto-run low-risk",
        body: "Jua may auto-send a private check-in request to the founder. Recording a KPI and posting to the public ledger still need your approve.",
    },
    {
        id: "pause_all" as const,
        label: "Pause all automation",
        body: "Proposals still appear, but approve and manual runs are blocked until you resume.",
    },
];

export default function AccountScreen() {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const briefing = useQuery(api.invest.todayBriefing, {});
    const myVenture = useQuery(api.venture.myVenture);
    const me = useQuery(api.softAuth.whoAmI);
    const setAutonomy = useMutation(api.invest.setInvestorAutonomy);
    const requireAuthToAct = useRequireAuthToAct();
    const current = briefing?.autonomyLevel ?? "ask_every_time";

    // One account can be both investor and founder — this is workspace
    // switching, not a second role or a second sign-in.
    const investorName = me?.name ?? me?.email ?? null;
    const founderVentureName = myVenture?.name ?? null;

    return (
        <ScrollView
            style={{ flex: 1, backgroundColor: color.stone }}
            contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16 }]}
        >
            <Pressable onPress={() => router.back()} hitSlop={10}>
                <Text style={styles.link}>← Back</Text>
            </Pressable>
            <Text style={styles.title}>Account</Text>
            <SoftIdentityBar />

            <SectionLabel>Workspaces</SectionLabel>
            <Text style={styles.workspaceHint}>
                One account, two sides of the loop. Switch between where you invest
                and the venture you run.
            </Text>
            <View style={styles.workspaceRow}>
                <View style={styles.workspaceCopy}>
                    <Text style={styles.workspaceLabel}>Investor</Text>
                    <Text style={styles.workspaceBody}>
                        {investorName ? `Investing as ${investorName}` : "Not signed in"}
                    </Text>
                </View>
                <Button label="Open deals" onPress={() => router.push("/(tabs)/deals")} />
            </View>
            <View style={styles.workspaceRow}>
                <View style={styles.workspaceCopy}>
                    <Text style={styles.workspaceLabel}>Founder</Text>
                    <Text style={styles.workspaceBody}>
                        {founderVentureName
                            ? `Running ${founderVentureName}`
                            : "No venture claimed yet"}
                    </Text>
                </View>
                <Button
                    label={founderVentureName ? "Open workspace" : "Claim workspace"}
                    onPress={() => router.push("/workspace/founder")}
                />
            </View>

            <SectionLabel>Agent autonomy</SectionLabel>
            <AuthRequiredGate required={requireAuthToAct}>
                {LEVELS.map((level) => {
                    const active = current === level.id;
                    return (
                        <Pressable
                            key={level.id}
                            onPress={() => void setAutonomy({ autonomyLevel: level.id })}
                            style={[styles.level, active && styles.levelActive]}
                        >
                            <Text style={styles.levelLabel}>{level.label}</Text>
                            <Text style={styles.levelBody}>{level.body}</Text>
                        </Pressable>
                    );
                })}
            </AuthRequiredGate>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    scroll: { padding: 16, gap: 14, paddingBottom: 48 },
    title: {
        fontFamily: font.display,
        fontSize: 28,
        fontWeight: "700",
        color: color.charcoal,
    },
    link: { ...type.meta, color: color.brassDeep, fontWeight: "700" },
    workspaceHint: { ...type.meta, fontSize: 13, lineHeight: 18, color: color.mist },
    workspaceRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: 14,
        borderWidth: 1,
        borderColor: color.line,
        borderRadius: 4,
        backgroundColor: color.paper,
    },
    workspaceCopy: { flex: 1, gap: 2 },
    workspaceLabel: { ...type.body, fontFamily: font.bodyBold, fontSize: 15 },
    workspaceBody: { ...type.meta, fontSize: 13, lineHeight: 18 },
    level: {
        padding: 14,
        borderWidth: 1,
        borderColor: color.line,
        borderRadius: 4,
        gap: 6,
        backgroundColor: color.paper,
    },
    levelActive: {
        borderColor: color.brass,
        backgroundColor: color.brassSoft,
    },
    levelLabel: { ...type.body, fontFamily: font.bodyBold, fontSize: 15 },
    levelBody: { ...type.meta, fontSize: 13, lineHeight: 18 },
});
