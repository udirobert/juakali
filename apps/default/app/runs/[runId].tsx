import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Approval } from "@/components/jua-kali/approval";
import { LivingSun } from "@/components/jua-kali/living-sun";
import { AuthRequiredGate, useRequireAuthToAct } from "@/components/jua-kali/soft-identity";
import { Button, Input, SectionLabel } from "@/components/jua-kali/ui";
import { color, type } from "@/components/jua-kali/theme";

export default function RunScreen() {
    const { runId } = useLocalSearchParams<{ runId: string }>();
    const run = useQuery(
        api.agentRuns.getAgentRun,
        runId ? { runId: runId as Id<"agentRuns"> } : "skip"
    );
    const submitEvidence = useMutation(api.agentRuns.submitFounderEvidence);
    const requireAuthToAct = useRequireAuthToAct();
    const insets = useSafeAreaInsets();
    const router = useRouter();

    const [evidenceValue, setEvidenceValue] = useState("");
    const [evidenceNote, setEvidenceNote] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    if (run === undefined) {
        return (
            <View style={styles.boot}>
                <ActivityIndicator color={color.brass} />
            </View>
        );
    }
    if (!run) {
        return (
            <View style={styles.boot}>
                <Text style={styles.body}>Run not found.</Text>
            </View>
        );
    }

    const agentState =
        run.status === "running"
            ? "executing"
            : run.status === "completed"
              ? "verified"
              : run.status === "failed"
                ? "blocked"
                : run.status === "waiting_for_response"
                  ? "observing"
                  : "observing";

    async function handleSubmitEvidence() {
        if (!runId) return;
        const value = Number(evidenceValue);
        if (!Number.isFinite(value) || value <= 0) {
            setSubmitError("Enter a positive number.");
            return;
        }
        setSubmitting(true);
        setSubmitError(null);
        try {
            await submitEvidence({
                runId: runId as Id<"agentRuns">,
                value,
                note: evidenceNote.trim() || undefined,
            });
            setEvidenceValue("");
            setEvidenceNote("");
        } catch (e) {
            setSubmitError(e instanceof Error ? e.message : "Could not submit evidence.");
        } finally {
            setSubmitting(false);
        }
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
                <LivingSun
                    size={48}
                    agentState={agentState}
                    working={run.status === "running"}
                />
                <View style={{ flex: 1 }}>
                    <Text style={styles.title}>{run.subject}</Text>
                    <Text style={styles.meta}>{run.status} · {run.trigger}</Text>
                    {run.evidenceSource ? (
                        <Text style={styles.meta}>
                            Source: {run.evidenceSource === "investor_entered" ? "entered by investor; founder verification not captured" : "submitted directly by founder"}
                        </Text>
                    ) : null}
                </View>
            </View>

            <SectionLabel>Progress</SectionLabel>
            {run.steps.map((step) => (
                <View key={step.tool} style={styles.step}>
                    <Text style={styles.stepStatus}>{step.status}</Text>
                    <View style={{ flex: 1 }}>
                        <Text style={styles.stepLabel}>{step.label}</Text>
                        {step.detail ? <Text style={styles.meta}>{step.detail}</Text> : null}
                    </View>
                </View>
            ))}

            {run.status === "waiting_for_response" ? (
                <AuthRequiredGate required={requireAuthToAct}>
                    <View style={styles.evidence}>
                        <SectionLabel>Evidence from the founder</SectionLabel>
                        <Text style={styles.body}>
                            Jua requested a check-in. Enter a number received from the founder to
                            continue — nothing is logged without a real response.
                        </Text>
                        <Input
                            value={evidenceValue}
                            onChangeText={setEvidenceValue}
                            keyboardType="number-pad"
                            placeholder="KPI value"
                            style={styles.input}
                        />
                        <Input
                            value={evidenceNote}
                            onChangeText={setEvidenceNote}
                            placeholder="Note (optional)"
                            multiline
                            style={styles.input}
                        />
                        <Button
                            label={submitting ? "Submitting…" : "Record received number"}
                            onPress={() => void handleSubmitEvidence()}
                            disabled={submitting}
                        />
                        {submitError ? <Text style={styles.error}>{submitError}</Text> : null}
                    </View>
                </AuthRequiredGate>
            ) : null}

            {run.error ? (
                <AuthRequiredGate required={requireAuthToAct}>
                    <Approval.Recovery
                        runId={run.id}
                        error={run.error}
                        onRetried={(id) => router.replace(`/runs/${id}`)}
                    />
                </AuthRequiredGate>
            ) : null}

            {run.result ? (
                <View style={styles.result}>
                    <SectionLabel>Result</SectionLabel>
                    <Text style={styles.body}>{run.result.message}</Text>
                </View>
            ) : null}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    boot: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: color.stone },
    scroll: { padding: 16, gap: 12, paddingBottom: 40 },
    head: { flexDirection: "row", gap: 12, alignItems: "center" },
    title: { ...type.title, fontSize: 22 },
    body: { ...type.body },
    meta: { ...type.meta },
    link: { ...type.meta, color: color.brassDeep, fontWeight: "700", marginBottom: 8 },
    step: { flexDirection: "row", gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line },
    stepStatus: { ...type.meta, width: 72, textTransform: "uppercase", fontSize: 10 },
    stepLabel: { ...type.body, fontSize: 15 },
    result: { gap: 6, marginTop: 8 },
    evidence: { gap: 8, marginTop: 8 },
    input: { minHeight: 44 },
    error: { ...type.meta, color: color.danger ?? "#8B3A2F" },
});
