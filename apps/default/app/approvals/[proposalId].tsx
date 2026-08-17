import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Approval, type ActionPlanView } from "@/components/jua-kali/approval";
import { AuthRequiredGate, useRequireAuthToAct } from "@/components/jua-kali/soft-identity";
import { color, type } from "@/components/jua-kali/theme";

export default function ApprovalScreen() {
    const { proposalId } = useLocalSearchParams<{ proposalId: string }>();
    // Canonical persisted plan — the single representation of this approval
    // contract, identical to what Today renders (no reconstructed fallback).
    const plan = useQuery(
        api.agentRuns.getProposalDetail,
        proposalId ? { runId: proposalId as Id<"agentRuns"> } : "skip"
    );
    const requireAuthToAct = useRequireAuthToAct();
    const router = useRouter();

    if (plan === undefined) {
        return (
            <View style={styles.boot}>
                <ActivityIndicator color={color.brass} />
            </View>
        );
    }
    if (!plan) {
        return (
            <View style={styles.boot}>
                {/* Header is drawn by the Stack (below) — no manual inset here. */}
                <Stack.Screen options={{ headerShown: true, title: "Approval" }} />
                <Text style={styles.empty}>This approval is no longer pending.</Text>
                <Pressable onPress={() => router.replace("/(tabs)/today")}>
                    <Text style={styles.link}>Back to Today</Text>
                </Pressable>
            </View>
        );
    }

    const approvalPlan: ActionPlanView = plan;

    return (
        <ScrollView
            contentContainerStyle={styles.scroll}
            style={{ flex: 1, backgroundColor: color.stone }}
        >
            {/* Single source of chrome: the Stack header. No manual Back control
                or safe-area padding here, so there is no duplicate inset. */}
            <Stack.Screen options={{ headerShown: true, title: "Approval" }} />
            <AuthRequiredGate required={requireAuthToAct}>
                <Approval.Provider plan={approvalPlan}>
                    <Approval.Card>
                        <Approval.Preview />
                        <Approval.Actions
                            onApproved={(runId) => router.replace(`/runs/${runId}`)}
                            onDismissed={() => router.replace("/(tabs)/today")}
                        />
                    </Approval.Card>
                </Approval.Provider>
            </AuthRequiredGate>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    boot: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: color.stone, gap: 12 },
    scroll: { padding: 16, gap: 16, paddingBottom: 40 },
    empty: { ...type.body },
    link: { ...type.meta, color: color.brassDeep, fontWeight: "700" },
});
