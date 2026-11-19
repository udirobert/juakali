import { Head, useLocalSearchParams, useRouter } from "expo-router";
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { LivingSun } from "@/components/jua-kali/living-sun";
import { DetailSkeleton } from "@/components/jua-kali/loaders/detail-skeleton";
import { OnchainSeal } from "@/components/jua-kali/onchain-seal";
import { VerifyLens } from "@/components/jua-kali/verify-lens";
import { SectionLabel } from "@/components/jua-kali/ui";
import { color, font, radius, type } from "@/components/jua-kali/theme";
import { explorerTxUrl } from "@/lib/bch/network";

const CHAIN_LABELS: Record<string, string> = {
    pledge: "Investor intent",
    checkin: "KPI evidence",
    digest: "Jua digest",
    action: "Agent execution",
    wisdom: "Mentor wisdom",
    repayment: "On-chain repayment",
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
        return <DetailSkeleton accessibilityLabel="Loading the proof event" />;
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
            <Head>
                <title>{`${event.ventureName ?? "Venture"} — JuaKali public proof`}</title>
                <meta name="description" content={event.summary} />
            </Head>
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

            <VerifyLens
                rawLines={[
                    ["record", `ledgerEvents/${event.id}`],
                    ["type", event.type],
                    ["createdAt", new Date(event.createdAt).toISOString()],
                    ["initiator", event.initiator ?? "—"],
                    ["visibility", event.publicVisible ? "public" : "private"],
                    ["disputeState", event.disputeState ?? "none"],
                    ["correlationId", event.correlationId ?? "—"],
                    ...(event.txid ? ([["txid", event.txid]] as [string, string][]) : []),
                    ...(event.onchainRef
                        ? ([["settlement", event.onchainRef]] as [string, string][])
                        : []),
                ]}
            />

            {event.txid ? (
                <View style={styles.evidenceSlab}>
                    <View style={styles.evidenceHead}>
                        <Text style={styles.evidenceEyebrow}>Settled on Bitcoin Cash</Text>
                        <Text style={styles.evidenceNet}>
                            {event.onchainRef?.includes("/chipnet/") ? "chipnet" : "mainnet"}
                        </Text>
                    </View>
                    <OnchainSeal
                        txid={event.txid}
                        network={event.onchainRef?.includes("/chipnet/") ? "chipnet" : "mainnet"}
                        onchainRef={event.onchainRef}
                    />
                    <Text selectable style={styles.txid}>
                        {event.txid}
                    </Text>
                    <Pressable
                        onPress={() =>
                            void Linking.openURL(event.onchainRef ?? explorerTxUrl(event.txid!))
                        }
                        hitSlop={6}
                        accessibilityRole="link"
                    >
                        <Text style={styles.link}>Verify independently on the explorer →</Text>
                    </Pressable>
                    <Text style={styles.evidenceNote}>
                        This txid is the fingerprint — anyone can confirm the transfer on-chain
                        without trusting this ledger.
                    </Text>
                </View>
            ) : null}

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
    txid: {
        ...type.meta,
        fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
        fontSize: 11,
    },
    evidenceSlab: {
        gap: 10,
        padding: 14,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: color.brassBorder,
        backgroundColor: color.foam,
    },
    evidenceHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    evidenceEyebrow: { ...type.eyebrow, fontSize: 10 },
    evidenceNet: {
        fontFamily: font.bodyBold,
        fontSize: 9,
        fontWeight: "700",
        letterSpacing: 0.8,
        textTransform: "uppercase",
        color: color.mist,
    },
    evidenceNote: { ...type.meta, fontSize: 11, lineHeight: 16, color: color.mistSoft },
    chainRow: { flexDirection: "row", gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line },
    chainN: { ...type.meta, width: 20, color: color.brassDeep, fontWeight: "700" },
    chainType: { ...type.meta, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 },
});
