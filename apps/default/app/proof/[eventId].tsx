import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { LivingSun } from "@/components/jua-kali/living-sun";
import { DetailSkeleton } from "@/components/jua-kali/loaders/detail-skeleton";
import { SectionLabel } from "@/components/jua-kali/ui";
import { color, type } from "@/components/jua-kali/theme";

const CHAIN_LABELS: Record<string, string> = {
    pledge: "Investor intent",
    checkin: "KPI evidence",
    digest: "Jua digest",
    action: "Agent execution",
    wisdom: "Mentor wisdom",
};

function chainLabel(link: { type: string; evidence: string[] }): string {
    if (link.evidence.includes("investor-entered")) return "Investor-entered KPI evidence";
    if (link.evidence.includes("founder-update")) return "Founder-submitted KPI evidence";
    if (link.evidence.includes("self") && link.type === "checkin") return "Founder self-report";
    return CHAIN_LABELS[link.type] ?? link.type;
}

export default function ProofEventScreen() {
    const { eventId } = useLocalSearchParams<{ eventId: string }>();
    const event = useQuery(
        api.invest.proofEvent,
        eventId ? { eventId: eventId as Id<"ledgerEvents"> } : "skip"
    );
    const insets = useSafeAreaInsets();
    const router = useRouter();

    if (event === undefined) {
        return <DetailSkeleton />;
    }
    if (!event) {
        return (
            <View style={styles.boot}>
                <Text style={styles.body}>Proof event not found.</Text>
            </View>
        );
    }

    return (
        <ScrollView
            style={{ flex: 1, backgroundColor: color.stone }}
            contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16 }]}
        >
            <Pressable onPress={() => router.back()} hitSlop={10}>
                <Text style={styles.link}>← Back</Text>
            </Pressable>
            <View style={styles.head}>
                <LivingSun size={44} agentState="verified" />
                <View style={{ flex: 1 }}>
                    <Text style={styles.eyebrow}>Public proof</Text>
                    <Text style={styles.title}>{event.ventureName ?? "Venture"}</Text>
                </View>
            </View>
            <Text style={styles.body}>{event.summary}</Text>
            <Text style={styles.meta}>
                {event.publicVisible ? "Public" : "Private"} · Initiator:{" "}
                {event.initiator ?? "unknown"} · {event.disputeState ?? "none"}
            </Text>

            <SectionLabel>Causal chain</SectionLabel>
            {event.chain.map((link, index) => (
                <View key={link.id} style={styles.chainRow}>
                    <Text style={styles.chainN}>{index + 1}</Text>
                    <View style={{ flex: 1 }}>
                        <Text style={styles.chainType}>
                            {chainLabel(link)}
                            {link.causedBy ? " · caused by previous" : " · related activity"}
                        </Text>
                        <Text style={styles.body}>{link.summary}</Text>
                        <Text style={styles.meta}>
                            {link.initiator ?? "—"} ·{" "}
                            {link.publicVisible ? "public" : "private"} ·{" "}
                            {new Date(link.createdAt).toLocaleString()}
                        </Text>
                        {link.approvalRunId ? (
                            <Pressable onPress={() => router.push(`/runs/${link.approvalRunId}`)}>
                                <Text style={styles.link}>Authorized by approval →</Text>
                            </Pressable>
                        ) : null}
                    </View>
                </View>
            ))}

            {event.runId ? (
                <Pressable onPress={() => router.push(`/runs/${event.runId}`)}>
                    <Text style={styles.link}>Open related run →</Text>
                </Pressable>
            ) : null}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    boot: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: color.stone },
    scroll: { padding: 16, gap: 12, paddingBottom: 40 },
    head: { flexDirection: "row", gap: 12, alignItems: "center" },
    eyebrow: { ...type.meta, textTransform: "uppercase", letterSpacing: 0.6 },
    title: { ...type.title, fontSize: 22 },
    body: { ...type.body, fontSize: 15, lineHeight: 22 },
    meta: { ...type.meta },
    link: { ...type.meta, color: color.brassDeep, fontWeight: "700" },
    chainRow: { flexDirection: "row", gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line },
    chainN: { ...type.meta, width: 20, color: color.brassDeep, fontWeight: "700" },
    chainType: { ...type.meta, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 },
});
