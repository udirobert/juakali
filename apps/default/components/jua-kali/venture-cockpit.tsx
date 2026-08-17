import { useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    Text,
    TextInput,
    useWindowDimensions,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SITE_URL } from "@/lib/site";
import { SoftIdentityBar } from "@/components/jua-kali/soft-identity";
import { LivingSun } from "@/components/jua-kali/living-sun";
import { IconArrowRight, IconLedger, IconSparkle, IconTrend } from "@/components/jua-kali/icons";
import { Button, Card, Chip } from "@/components/jua-kali/ui";
import { WisdomItemCard } from "@/components/jua-kali/wisdom";
import { useDictation } from "@/components/jua-kali/hooks/use-dictation";
import { tapHaptic } from "@/components/jua-kali/haptics";
import { color, layout } from "@/components/jua-kali/theme";
import { styles } from "@/components/jua-kali/venture-cockpit/venture-cockpit.styles";

type UpdateTag = "situation" | "problem" | "opportunity" | "win";
type CheckInPhase = "prompt" | "capture" | "followup" | "preview" | "form";

const TAGS: Array<{ id: UpdateTag; label: string }> = [
    { id: "situation", label: "Situation" },
    { id: "problem", label: "Problem" },
    { id: "opportunity", label: "Opportunity" },
    { id: "win", label: "Win" },
];

function relativeTime(ts: number): string {
    const mins = Math.floor((Date.now() - ts) / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

/**
 * The entrepreneur's cockpit — their side of the loop. Their sun rises with
 * their KPI; mentor wisdom arrives as applied context cards with measured
 * outcomes; sharing a situation goes through Jua, who turns it into the
 * digest their mentors read and the ledger proves.
 */
export function VentureCockpit({ onOpenLedger }: { onOpenLedger?: () => void }) {
    const insets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    const padX = Math.max(14, Math.min(28, (width - layout.maxWidth) / 2 + 16));

    const venture = useQuery(api.venture.myVenture);
    const openRequests = useQuery(api.venture.openFounderRequests);
    const claimVenture = useMutation(api.venture.claimVenture);
    const postUpdate = useMutation(api.venture.postVentureUpdate);
    const logCheckIn = useMutation(api.venture.logSelfCheckIn);

    const [claiming, setClaiming] = useState(false);
    const [tag, setTag] = useState<UpdateTag>("situation");
    const [body, setBody] = useState("");
    const [followUp, setFollowUp] = useState("");
    const [kpiText, setKpiText] = useState("");
    const [status, setStatus] = useState<string | null>(null);
    const [sending, setSending] = useState(false);
    const [phase, setPhase] = useState<CheckInPhase>("prompt");
    const [selectedCommitmentId, setSelectedCommitmentId] = useState<Id<"commitments"> | null>(null);
    const dictation = useDictation((transcript) =>
        setBody((prev) => (prev ? `${prev} ${transcript}` : transcript)),
    );

    useEffect(() => {
        if (!openRequests || openRequests.length !== 1) return;
        setSelectedCommitmentId((current) => current ?? openRequests[0]!.commitmentId);
    }, [openRequests]);

    async function handleClaim() {
        setClaiming(true);
        setStatus(null);
        try {
            const result = await claimVenture({});
            setStatus(result.message);
        } catch (e) {
            setStatus(e instanceof Error ? e.message : "Could not claim.");
        } finally {
            setClaiming(false);
        }
    }

    async function handleUpdate() {
        const text = followUp.trim()
            ? `${body.trim()}\n\nFollow-up: ${followUp.trim()}`
            : body.trim();
        if (!text) {
            setStatus("Write a few words first.");
            return;
        }
        const kpiValue = kpiText.trim() ? Number(kpiText) : undefined;
        setSending(true);
        setStatus(null);
        try {
            if (openRequests && openRequests.length > 1 && !selectedCommitmentId) {
                setStatus("Select which investor request this update answers.");
                return;
            }
            const result = await postUpdate({
                body: text,
                tag,
                kpiValue: Number.isFinite(kpiValue) && kpiValue && kpiValue > 0 ? kpiValue : undefined,
                commitmentId: selectedCommitmentId ?? undefined,
            });
            setStatus(result.message);
            setBody("");
            setFollowUp("");
            setKpiText("");
            setPhase("prompt");
        } catch (e) {
            setStatus(e instanceof Error ? e.message : "Could not send.");
        } finally {
            setSending(false);
        }
    }

    async function handleCheckIn() {
        const value = Number(kpiText);
        if (!Number.isFinite(value) || value <= 0) {
            setStatus("Enter your number for this week.");
            return;
        }
        setSending(true);
        try {
            const result = await logCheckIn({ value, note: body.trim() || undefined });
            setStatus(result.message);
            setKpiText("");
        } catch (e) {
            setStatus(e instanceof Error ? e.message : "Could not log.");
        } finally {
            setSending(false);
        }
    }

    const lastCheckIn =
        venture && typeof venture === "object" && "checkIns" in venture
            ? venture.checkIns[0] ?? null
            : null;
    const agentPrompt = useMemo(() => {
        if (!venture) return "What changed this week?";
        if (lastCheckIn) {
            return `Last week you reported ${lastCheckIn.value} on ${venture.kpiLabel.toLowerCase()}. What changed?`;
        }
        return `You're tracking ${venture.kpiLabel.toLowerCase()}. What should mentors know this week?`;
    }, [venture, lastCheckIn]);

    const publicPreview = useMemo(() => {
        const parts = [body.trim()];
        if (followUp.trim()) parts.push(followUp.trim());
        if (kpiText.trim()) parts.push(`KPI note: ${kpiText.trim()}`);
        return parts.filter(Boolean).join("\n\n") || "—";
    }, [body, followUp, kpiText]);

    if (venture === undefined) {
        return (
            <View style={[styles.screen, { paddingTop: insets.top }]}>
                <ActivityIndicator color={color.brass} />
            </View>
        );
    }

    // No venture yet — the claim card (demo entry: ?venture=1).
    if (venture === null) {
        return (
            <View style={[styles.screen, { paddingTop: insets.top + 16 }]}>
                <ScrollView
                    contentContainerStyle={[styles.content, { paddingHorizontal: padX, maxWidth: layout.maxWidth, width: "100%", alignSelf: "center" }]}
                    showsVerticalScrollIndicator={false}
                >
                    <Card>
                        <View style={styles.titleRow}>
                            <LivingSun progress={0.3} size={18} />
                            <Text style={styles.title}>Run your venture</Text>
                        </View>
                        <Text style={styles.body}>
                            This is the founder side of JuaKali — your KPI, the wisdom your mentors
                            share, and a direct line to Jua. Sign in and claim a demo venture to
                            see it live.
                        </Text>
                        <SoftIdentityBar forceOpen heading="Sign in to claim your venture" />
                        <Button
                            label={claiming ? "Claiming…" : "Claim a demo venture"}
                            onPress={() => void handleClaim()}
                            busy={claiming}
                        />
                        {status ? <Text style={styles.status}>{status}</Text> : null}
                    </Card>
                </ScrollView>
            </View>
        );
    }

    const progress =
        venture.kpiTarget > 0 ? Math.min(1, venture.kpiTotal / venture.kpiTarget) : 0;

    return (
        <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
            <ScrollView
                contentContainerStyle={[
                    styles.content,
                    {
                        paddingHorizontal: padX,
                        paddingBottom: Math.max(insets.bottom, 20) + 80,
                        maxWidth: layout.maxWidth,
                        width: "100%",
                        alignSelf: "center",
                    },
                ]}
                showsVerticalScrollIndicator={false}
            >
                {/* Their sun rises with their own number. */}
                <View style={styles.hero}>
                    <LivingSun progress={progress} size={44} />
                    <View style={styles.heroBody}>
                        <Text style={styles.title}>{venture.name}</Text>
                        <Text style={styles.sub}>
                            {venture.craftText} · {venture.locationText}
                        </Text>
                    </View>
                </View>

                <Card>
                    <View style={styles.kpiRow}>
                        <View style={styles.kpiBlock}>
                            <Text style={styles.kpiValue}>{venture.kpiTotal}</Text>
                            <Text style={styles.kpiLabel}>{venture.kpiLabel.toLowerCase()}</Text>
                        </View>
                        <View style={styles.kpiDivider} />
                        <View style={styles.kpiBlock}>
                            <Text style={styles.kpiValue}>{venture.kpiTarget}</Text>
                            <Text style={styles.kpiLabel}>target</Text>
                        </View>
                    </View>
                    <View style={styles.progressTrack}>
                        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
                    </View>
                    {status ? <Text style={styles.status}>{status}</Text> : null}
                </Card>

                {openRequests && openRequests.length > 0 ? (
                    <Card>
                        <View style={styles.titleRow}>
                            <IconLedger size={15} color={color.brassDeep} />
                            <Text style={styles.cardTitle}>Open investor requests</Text>
                        </View>
                        <Text style={styles.hint}>
                            Choose the request before sending a KPI update. This keeps your response attached to the right investor.
                        </Text>
                        {openRequests.map((request) => (
                            <Pressable
                                key={request.runId}
                                onPress={() => setSelectedCommitmentId(request.commitmentId)}
                                style={[
                                    styles.requestRow,
                                    selectedCommitmentId === request.commitmentId && styles.requestRowSelected,
                                ]}
                                accessibilityRole="button"
                                accessibilityState={{ selected: selectedCommitmentId === request.commitmentId }}
                            >
                                <View style={{ flex: 1, gap: 2 }}>
                                    <Text style={styles.requestInvestor}>{request.investorName}</Text>
                                    <Text style={styles.hint} numberOfLines={2}>{request.requestBody}</Text>
                                </View>
                                <Text style={styles.requestMark}>
                                    {selectedCommitmentId === request.commitmentId ? "Selected" : "Select"}
                                </Text>
                            </Pressable>
                        ))}
                    </Card>
                ) : null}

                {/* Conversational check-in — form remains as fallback. */}
                <Card>
                    <View style={styles.titleRow}>
                        <IconSparkle size={15} color={color.brassDeep} />
                        <Text style={styles.cardTitle}>Weekly check-in with Jua</Text>
                    </View>

                    {phase === "prompt" || phase === "capture" ? (
                        <>
                            <Text style={styles.body}>{agentPrompt}</Text>
                            <View style={styles.composerRow}>
                                <TextInput
                                    value={body}
                                    onChangeText={setBody}
                                    multiline
                                    style={styles.composerInput}
                                    placeholder="Speak or type what changed…"
                                    placeholderTextColor={color.mist}
                                    maxLength={2000}
                                    onFocus={() => setPhase("capture")}
                                />
                                {dictation.supported ? (
                                    <Pressable
                                        onPress={() => {
                                            tapHaptic();
                                            dictation.toggle();
                                            setPhase("capture");
                                        }}
                                        style={[styles.micButton, dictation.listening && styles.micListening]}
                                        accessibilityRole="button"
                                        accessibilityLabel={dictation.listening ? "Stop dictation" : "Dictate"}
                                    >
                                        <IconSparkle size={16} color={dictation.listening ? color.paper : color.brassDeep} />
                                    </Pressable>
                                ) : null}
                            </View>
                            {dictation.listening ? <Text style={styles.listening}>Listening…</Text> : null}
                            <Button
                                label="Continue"
                                onPress={() => setPhase("followup")}
                                disabled={!body.trim()}
                                icon={<IconArrowRight size={14} color={color.paper} />}
                            />
                        </>
                    ) : null}

                    {phase === "followup" ? (
                        <>
                            <Text style={styles.body}>
                                One follow-up: what should mentors watch for next week?
                            </Text>
                            <TextInput
                                value={followUp}
                                onChangeText={setFollowUp}
                                multiline
                                style={styles.composerInput}
                                placeholder="Optional — one sentence is enough"
                                placeholderTextColor={color.mist}
                            />
                            <TextInput
                                value={kpiText}
                                onChangeText={setKpiText}
                                keyboardType="number-pad"
                                style={styles.kpiInput}
                                placeholder={`This week's ${venture.kpiLabel.toLowerCase()} (optional)`}
                                placeholderTextColor={color.mist}
                            />
                            <Button label="Preview public update" onPress={() => setPhase("preview")} />
                        </>
                    ) : null}

                    {phase === "preview" ? (
                        <>
                            <Text style={styles.hint}>Confirm before Jua turns this into a digest path.</Text>
                            <Text style={styles.body}>{publicPreview}</Text>
                            <Button
                                label={sending ? "Sending…" : "Confirm & send to Jua"}
                                onPress={() => void handleUpdate()}
                                busy={sending}
                            />
                            <Button label="Edit" variant="ghost" onPress={() => setPhase("capture")} />
                        </>
                    ) : null}

                    {phase === "form" ? (
                        <>
                            <Text style={styles.hint}>Tagged form fallback</Text>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tagRow}>
                                {TAGS.map((t) => (
                                    <Chip key={t.id} label={t.label} active={tag === t.id} onPress={() => setTag(t.id)} />
                                ))}
                            </ScrollView>
                            <View style={styles.composerRow}>
                                <TextInput
                                    value={body}
                                    onChangeText={setBody}
                                    multiline
                                    style={styles.composerInput}
                                    placeholder="What moved, what's stuck, what's next…"
                                    placeholderTextColor={color.mist}
                                    maxLength={2000}
                                />
                            </View>
                            <View style={styles.kpiInputRow}>
                                <TextInput
                                    value={kpiText}
                                    onChangeText={setKpiText}
                                    style={styles.kpiInput}
                                    placeholder={`This week's ${venture.kpiLabel.toLowerCase()}`}
                                    placeholderTextColor={color.mist}
                                    keyboardType="number-pad"
                                />
                                <Button label="Send to Jua" onPress={() => void handleUpdate()} busy={sending} />
                            </View>
                            <Pressable onPress={() => void handleCheckIn()} hitSlop={6} accessibilityRole="button">
                                <Text style={styles.selfLink}>Log this number only (self check-in)</Text>
                            </Pressable>
                        </>
                    ) : null}

                    {phase !== "form" ? (
                        <Pressable onPress={() => setPhase("form")} hitSlop={8}>
                            <Text style={styles.hint}>More options — tagged form →</Text>
                        </Pressable>
                    ) : (
                        <Pressable onPress={() => setPhase("prompt")} hitSlop={8}>
                            <Text style={styles.hint}>← Back to guided check-in</Text>
                        </Pressable>
                    )}
                </Card>

                {/* Wisdom received — applied mentor advice with outcomes. */}
                <WisdomForVenture ventureId={venture.ventureId} ventureName={venture.name} />

                {venture.checkIns.length > 0 ? (
                    <Card>
                        <View style={styles.titleRow}>
                            <IconTrend size={15} color={color.brassDeep} />
                            <Text style={styles.cardTitle}>Your check-ins</Text>
                        </View>
                        {venture.checkIns.slice(0, 5).map((checkIn) => (
                            <View key={checkIn.id} style={styles.checkInRow}>
                                <Text style={styles.checkInValue}>+{checkIn.value}</Text>
                                <Text style={styles.checkInNote} numberOfLines={1}>
                                    {checkIn.note}
                                </Text>
                                <Text style={styles.checkInWhen}>{relativeTime(checkIn.createdAt)}</Text>
                            </View>
                        ))}
                    </Card>
                ) : null}

                {venture.recentDigests.length > 0 ? (
                    <Card variant="artifact">
                        <View style={styles.titleRow}>
                            <IconLedger size={15} color={color.brassDeep} />
                            <Text style={styles.cardTitle}>What your mentors read</Text>
                        </View>
                        {venture.recentDigests.map((digest) => (
                            <View key={digest.id} style={styles.digestRow}>
                                <Text style={styles.body}>{digest.summary}</Text>
                                <Text style={styles.checkInWhen}>{relativeTime(digest.createdAt)}</Text>
                            </View>
                        ))}
                    </Card>
                ) : null}

                {onOpenLedger ? (
                    <Button label="See my public proof" variant="ghost" onPress={onOpenLedger} icon={<IconArrowRight size={14} color={color.charcoal} />} style={styles.proofBtn} />
                ) : (
                    <Text style={styles.proofHint}>{SITE_URL}/deal/{venture.publicSlug}</Text>
                )}
            </ScrollView>
        </View>
    );
}

/** The owner's applied-wisdom list (live). */
function WisdomForVenture({ ventureId, ventureName }: { ventureId: string; ventureName: string }) {
    const items = useQuery(api.wisdom.wisdomForOwner, { ventureId: ventureId as never });
    if (items === undefined) return null;
    const applied = items.filter((item) => item.status === "applied");
    if (applied.length === 0) {
        return (
            <Card>
                <View style={styles.titleRow}>
                    <IconSparkle size={15} color={color.brassDeep} />
                    <Text style={styles.cardTitle}>Wisdom from your mentors</Text>
                </View>
                <Text style={styles.hint}>
                    When a mentor shares advice for {ventureName}, Jua shapes it into one action and
                    it lands here — with the result measured against your KPI.
                </Text>
            </Card>
        );
    }
    return (
        <View style={styles.wisdomStack}>
            {applied.map((item) => (
                <WisdomItemCard key={item.id} item={item} ventureName={ventureName} />
            ))}
        </View>
    );
}

