import { createContext, use, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useMutation } from "convex/react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button, Card, Input, SectionLabel } from "@/components/jua-kali/ui";
import { LivingSun } from "@/components/jua-kali/living-sun";
import { color, font, type } from "@/components/jua-kali/theme";

export type ActionPlanView = {
    id: string;
    commitmentId: string;
    ventureName: string;
    subject: string;
    noteBody: string;
    status: string;
    createdAt: number;
    reason: { whyNow: string; trigger: string; signals: string[] };
    sources: Array<{ kind: string; label: string; refId?: string | null }>;
    planSteps: Array<{
        tool: string;
        label: string;
        visibility: "public" | "private";
        effect: string;
    }>;
    preview: {
        messageDraft?: string | null;
        publicSummary?: string | null;
        kpiDelta?: string | null;
    };
    permissions: {
        scope: "once" | "policy";
        autonomyLevel: "ask_every_time" | "auto_low_risk" | "pause_all";
    };
    recovery: { onFail: "pause" | "retry" | "ask"; undoHint: string };
    durationEta?: string | null;
};

type ApprovalContextValue = {
    plan: ActionPlanView;
    messageDraft: string;
    publicSummary: string;
    editing: boolean;
    setMessageDraft: (v: string) => void;
    setPublicSummary: (v: string) => void;
    setEditing: (v: boolean) => void;
    busy: boolean;
    setBusy: (v: boolean) => void;
    statusMessage: string | null;
    setStatusMessage: (v: string | null) => void;
};

const ApprovalContext = createContext<ApprovalContextValue | null>(null);

function useApproval() {
    const value = use(ApprovalContext);
    if (!value) throw new Error("Approval components require Approval.Provider");
    return value;
}

function ApprovalProvider({
    plan,
    children,
}: {
    plan: ActionPlanView;
    children: ReactNode;
}) {
    const [messageDraft, setMessageDraft] = useState(
        plan.preview.messageDraft ?? plan.noteBody
    );
    const [publicSummary, setPublicSummary] = useState(plan.preview.publicSummary ?? "");
    const [editing, setEditing] = useState(false);
    const [busy, setBusy] = useState(false);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);

    return (
        <ApprovalContext
            value={{
                plan,
                messageDraft,
                publicSummary,
                editing,
                setMessageDraft,
                setPublicSummary,
                setEditing,
                busy,
                setBusy,
                statusMessage,
                setStatusMessage,
            }}
        >
            {children}
        </ApprovalContext>
    );
}

function ApprovalCard({ children }: { children?: ReactNode }) {
    const { plan } = useApproval();
    const publicSteps = plan.planSteps.filter((s) => s.visibility === "public");
    const privateSteps = plan.planSteps.filter((s) => s.visibility === "private");

    return (
        <Card variant="trust" style={styles.card}>
            <View style={styles.head}>
                <LivingSun size={36} progress={0.45} agentState="proposing" />
                <View style={styles.headCopy}>
                    <Text style={styles.eyebrow}>Needs approval</Text>
                    <Text style={styles.title}>{plan.ventureName}</Text>
                </View>
            </View>

            <Text style={styles.why}>{plan.reason.whyNow}</Text>

            {plan.reason.signals.length > 0 ? (
                <View style={styles.block}>
                    <SectionLabel>Why now</SectionLabel>
                    {plan.reason.signals.map((signal) => (
                        <Text key={signal} style={styles.bullet}>
                            · {signal}
                        </Text>
                    ))}
                </View>
            ) : null}

            {plan.sources.length > 0 ? (
                <View style={styles.block}>
                    <SectionLabel>Sources</SectionLabel>
                    {plan.sources.map((source) => (
                        <Text key={`${source.kind}-${source.label}`} style={styles.bullet}>
                            · {source.label}
                        </Text>
                    ))}
                </View>
            ) : null}

            <View style={styles.block}>
                <SectionLabel>I propose to</SectionLabel>
                {plan.planSteps.map((step) => (
                    <Text key={step.tool} style={styles.bullet}>
                        · {step.label} — {step.effect}
                        {step.visibility === "public" ? " (public)" : " (private)"}
                    </Text>
                ))}
            </View>

            <Text style={styles.meta}>
                Public effect:{" "}
                {publicSteps.length
                    ? publicSteps.map((s) => s.label).join(", ")
                    : "none until review"}
            </Text>
            <Text style={styles.meta}>
                Private only: {privateSteps.map((s) => s.label).join(", ") || "none"}
            </Text>
            <Text style={styles.meta}>Expected time: {plan.durationEta ?? "soon"}</Text>
            <Text style={styles.meta}>Permission: approve once — not a standing policy</Text>
            <Text style={styles.hint}>{plan.recovery.undoHint}</Text>

            {children}
        </Card>
    );
}

function ApprovalPreview() {
    const {
        editing,
        messageDraft,
        publicSummary,
        setMessageDraft,
        setPublicSummary,
    } = useApproval();

    if (!editing) {
        return (
            <View style={styles.block}>
                <SectionLabel>Preview</SectionLabel>
                <Text style={styles.previewLabel}>Follow-up message</Text>
                <Text style={styles.previewBody}>{messageDraft || "—"}</Text>
                {publicSummary ? (
                    <>
                        <Text style={styles.previewLabel}>Public summary</Text>
                        <Text style={styles.previewBody}>{publicSummary}</Text>
                    </>
                ) : null}
            </View>
        );
    }

    return (
        <View style={styles.block}>
            <SectionLabel>Edit before approve</SectionLabel>
            <Text style={styles.previewLabel}>Follow-up message</Text>
            <Input
                value={messageDraft}
                onChangeText={setMessageDraft}
                multiline
                style={styles.input}
            />
            <Text style={styles.previewLabel}>Public summary</Text>
            <Input
                value={publicSummary}
                onChangeText={setPublicSummary}
                multiline
                style={styles.input}
            />
        </View>
    );
}

function ApprovalActions({
    onApproved,
    onDismissed,
}: {
    onApproved?: (runId: Id<"agentRuns">) => void;
    onDismissed?: () => void;
}) {
    const {
        plan,
        messageDraft,
        publicSummary,
        editing,
        setEditing,
        busy,
        setBusy,
        statusMessage,
        setStatusMessage,
    } = useApproval();
    const approveProposal = useMutation(api.agentRuns.approveProposal);
    const dismissProposal = useMutation(api.agentRuns.dismissProposal);
    const updateProposalPlan = useMutation(api.agentRuns.updateProposalPlan);

    async function handleApprove() {
        setBusy(true);
        setStatusMessage(null);
        try {
            if (editing) {
                await updateProposalPlan({
                    runId: plan.id as Id<"agentRuns">,
                    messageDraft,
                    publicSummary,
                });
            }
            const result = await approveProposal({
                runId: plan.id as Id<"agentRuns">,
                messageDraft,
                publicSummary: publicSummary || undefined,
            });
            onApproved?.(result.runId);
        } catch (error) {
            setStatusMessage(error instanceof Error ? error.message : "Could not approve.");
        } finally {
            setBusy(false);
        }
    }

    async function handleDismiss() {
        setBusy(true);
        try {
            await dismissProposal({ runId: plan.id as Id<"agentRuns"> });
            onDismissed?.();
        } catch (error) {
            setStatusMessage(error instanceof Error ? error.message : "Could not dismiss.");
        } finally {
            setBusy(false);
        }
    }

    return (
        <View style={styles.actions}>
            <View style={styles.actionRow}>
                <Button
                    label={editing ? "Done editing" : "Review & edit"}
                    variant="ghost"
                    onPress={() => setEditing(!editing)}
                    disabled={busy}
                    style={styles.actionBtn}
                />
                <Button
                    label={busy ? "Working…" : "Approve once"}
                    onPress={() => void handleApprove()}
                    disabled={busy}
                    style={styles.actionBtn}
                />
            </View>
            <Pressable onPress={() => void handleDismiss()} disabled={busy} hitSlop={8}>
                <Text style={styles.dismiss}>Dismiss</Text>
            </Pressable>
            {statusMessage ? <Text style={styles.error}>{statusMessage}</Text> : null}
        </View>
    );
}

function ApprovalRecovery({
    runId,
    error,
    onRetried,
}: {
    runId: Id<"agentRuns">;
    error: string;
    onRetried?: (runId: Id<"agentRuns">) => void;
}) {
    const retryFailedRun = useMutation(api.agentRuns.retryFailedRun);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    return (
        <Card variant="trust" style={styles.card}>
            <LivingSun size={32} progress={0.2} agentState="blocked" />
            <Text style={styles.title}>Run blocked</Text>
            <Text style={styles.why}>{error}</Text>
            <Text style={styles.hint}>Retry restarts the same approved work from the beginning.</Text>
            <Button
                label={busy ? "Retrying…" : "Retry run"}
                onPress={() => {
                    void (async () => {
                        setBusy(true);
                        try {
                            const result = await retryFailedRun({ runId });
                            onRetried?.(result.runId);
                        } catch (e) {
                            setMessage(e instanceof Error ? e.message : "Retry failed.");
                        } finally {
                            setBusy(false);
                        }
                    })();
                }}
                disabled={busy}
            />
            {message ? <Text style={styles.error}>{message}</Text> : null}
        </Card>
    );
}

export const Approval = {
    Provider: ApprovalProvider,
    Card: ApprovalCard,
    Preview: ApprovalPreview,
    Actions: ApprovalActions,
    Recovery: ApprovalRecovery,
};

const styles = StyleSheet.create({
    card: { gap: 12, padding: 16 },
    head: { flexDirection: "row", alignItems: "center", gap: 12 },
    headCopy: { flex: 1, gap: 2 },
    eyebrow: {
        fontFamily: font.bodyBold,
        fontSize: 11,
        letterSpacing: 0.8,
        textTransform: "uppercase",
        color: color.brassDeep,
    },
    title: { ...type.title, fontSize: 20 },
    why: { ...type.body, fontSize: 16, lineHeight: 24 },
    block: { gap: 6 },
    bullet: { ...type.body, color: color.ink, fontSize: 14, lineHeight: 20 },
    meta: { ...type.meta, fontSize: 13 },
    hint: { ...type.meta, fontSize: 12, color: color.mist },
    previewLabel: { ...type.meta, marginTop: 4 },
    previewBody: { ...type.body, fontSize: 14, lineHeight: 20 },
    input: { minHeight: 72, textAlignVertical: "top" },
    actions: { gap: 10, marginTop: 4 },
    actionRow: { flexDirection: "row", gap: 8 },
    actionBtn: { flex: 1 },
    dismiss: {
        fontFamily: font.body,
        color: color.mist,
        textAlign: "center",
        fontSize: 13,
        textDecorationLine: "underline",
    },
    error: { ...type.meta, color: color.danger ?? "#8B3A2F" },
});
