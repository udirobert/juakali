import { useCallback, useEffect, useState } from "react";
import {
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    useWindowDimensions,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeIn } from "react-native-reanimated";
import * as SecureStore from "expo-secure-store";
import { useMutation } from "convex/react";
import type { Id } from "@/convex/_generated/dataModel";

import { api } from "@/convex/_generated/api";
import { color, font, layout } from "@/components/jua-kali/theme";

const STORAGE_KEY = "juakali_investor_onboarded_v3";

type KpiUnit = "meetings" | "revenue_kes" | "jobs";

async function readOnboarded(): Promise<boolean> {
    try {
        if (Platform.OS === "web" && typeof localStorage !== "undefined") {
            return localStorage.getItem(STORAGE_KEY) === "1";
        }
        return (await SecureStore.getItemAsync(STORAGE_KEY)) === "1";
    } catch {
        return false;
    }
}

async function writeOnboarded(): Promise<void> {
    try {
        if (Platform.OS === "web" && typeof localStorage !== "undefined") {
            localStorage.setItem(STORAGE_KEY, "1");
            return;
        }
        await SecureStore.setItemAsync(STORAGE_KEY, "1");
    } catch {
        // ignore
    }
}

export function useInvestorOnboardingGate() {
    const [ready, setReady] = useState(false);
    const [show, setShow] = useState(false);

    useEffect(() => {
        void readOnboarded().then((done) => {
            setShow(!done);
            setReady(true);
        });
    }, []);

    const complete = useCallback(async () => {
        await writeOnboarded();
        setShow(false);
    }, []);

    return { ready, show, complete };
}

const kpiPresets: Array<{ unit: KpiUnit; label: string; chip: string }> = [
    { unit: "meetings", label: "Meetings booked", chip: "Meetings" },
    { unit: "jobs", label: "Jobs completed", chip: "Jobs" },
    { unit: "revenue_kes", label: "Revenue (KES)", chip: "Revenue" },
];

export function InvestorLanding({
    onEnter,
}: {
    onEnter: (opts?: { commitmentId?: Id<"commitments"> }) => void;
}) {
    const insets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    const compact = width < 420;
    const startCommitment = useMutation(api.invest.startCommitment);
    const seedInvestDemo = useMutation(api.invest.seedInvestDemo);

    const [mode, setMode] = useState<"pitch" | "form">("pitch");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [investorName, setInvestorName] = useState("");
    const [investorEmail, setInvestorEmail] = useState("");
    const [ventureName, setVentureName] = useState("");
    const [craftText, setCraftText] = useState("");
    const [locationText, setLocationText] = useState("");
    const [kpiUnit, setKpiUnit] = useState<KpiUnit>("meetings");
    const [kpiTarget, setKpiTarget] = useState("20");
    const [amountKes, setAmountKes] = useState("10000");

    async function handleStart() {
        setError(null);
        const amount = Number(amountKes);
        const target = Number(kpiTarget);
        if (!investorName.trim()) {
            setError("Your name is required.");
            return;
        }
        if (!ventureName.trim()) {
            setError("Business name is required.");
            return;
        }
        if (!Number.isFinite(amount) || amount <= 0) {
            setError("Enter a positive pledge amount.");
            return;
        }
        if (!Number.isFinite(target) || target <= 0) {
            setError("Enter a positive KPI target.");
            return;
        }

        const preset = kpiPresets.find((p) => p.unit === kpiUnit)!;
        setBusy(true);
        try {
            const result = await startCommitment({
                investorName: investorName.trim(),
                investorEmail: investorEmail.trim() || undefined,
                ventureName: ventureName.trim(),
                craftText: craftText.trim() || "General",
                locationText: locationText.trim() || "Kenya",
                kpiLabel: preset.label,
                kpiUnit,
                kpiTarget: target,
                amountKes: amount,
            });
            if (Platform.OS === "web" && typeof window !== "undefined") {
                const url = new URL(window.location.href);
                url.searchParams.set("c", result.commitmentId);
                window.history.replaceState({}, "", url.toString());
            }
            onEnter({ commitmentId: result.commitmentId });
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not start commitment.");
        } finally {
            setBusy(false);
        }
    }

    async function handleExample() {
        setBusy(true);
        setError(null);
        try {
            await seedInvestDemo({});
            onEnter({});
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not load example.");
        } finally {
            setBusy(false);
        }
    }

    return (
        <View style={[styles.screen, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 }]}>
            <ScrollView
                contentContainerStyle={[styles.scroll, { maxWidth: layout.maxWidth }]}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                <Animated.View entering={FadeIn.duration(240)} style={styles.frame}>
                    <Text style={styles.brand}>JuaKali</Text>
                    <Text style={styles.eyebrow}>Invest in public</Text>

                    {mode === "pitch" ? (
                        <>
                            <Text style={styles.headline}>
                                {compact
                                    ? "You’re busy. Ventures aren’t."
                                    : "You’re busy. The venture still needs a weekly operator."}
                            </Text>

                            <View style={styles.loopRow}>
                                {[
                                    { label: "You", hint: "Pledge · note" },
                                    { label: "Agent", hint: "KPI · digest" },
                                    { label: "Ledger", hint: "Public proof" },
                                ].map((node, i) => (
                                    <View key={node.label} style={styles.loopCell}>
                                        {i > 0 ? <View style={styles.loopLine} /> : null}
                                        <View style={[styles.loopNode, node.label === "Agent" && styles.loopNodeOn]}>
                                            <View style={[styles.mark, node.label === "Agent" && styles.markOn]} />
                                            <Text style={styles.loopLabel}>{node.label}</Text>
                                            {!compact ? <Text style={styles.loopHint}>{node.hint}</Text> : null}
                                        </View>
                                    </View>
                                ))}
                            </View>

                            <Pressable
                                onPress={() => setMode("form")}
                                style={styles.cta}
                                accessibilityRole="button"
                            >
                                <Text style={styles.ctaText}>Start a commitment</Text>
                            </Pressable>
                            <Pressable onPress={() => void handleExample()} disabled={busy}>
                                <Text style={styles.secondary}>{busy ? "…" : "See an example"}</Text>
                            </Pressable>
                        </>
                    ) : (
                        <View style={styles.form}>
                            <Text style={styles.formTitle}>Your commitment</Text>

                            <Text style={styles.fieldLabel}>You</Text>
                            <TextInput
                                value={investorName}
                                onChangeText={setInvestorName}
                                placeholder="Your name"
                                placeholderTextColor={color.mist}
                                style={styles.input}
                            />
                            <TextInput
                                value={investorEmail}
                                onChangeText={setInvestorEmail}
                                placeholder="Email (optional)"
                                placeholderTextColor={color.mist}
                                keyboardType="email-address"
                                autoCapitalize="none"
                                style={styles.input}
                            />

                            <Text style={styles.fieldLabel}>Business</Text>
                            <TextInput
                                value={ventureName}
                                onChangeText={setVentureName}
                                placeholder="Business name"
                                placeholderTextColor={color.mist}
                                style={styles.input}
                            />
                            <View style={styles.row2}>
                                <TextInput
                                    value={craftText}
                                    onChangeText={setCraftText}
                                    placeholder="Craft"
                                    placeholderTextColor={color.mist}
                                    style={[styles.input, styles.half]}
                                />
                                <TextInput
                                    value={locationText}
                                    onChangeText={setLocationText}
                                    placeholder="Location"
                                    placeholderTextColor={color.mist}
                                    style={[styles.input, styles.half]}
                                />
                            </View>

                            <Text style={styles.fieldLabel}>Hard KPI</Text>
                            <View style={styles.chipRow}>
                                {kpiPresets.map((p) => (
                                    <Pressable
                                        key={p.unit}
                                        onPress={() => setKpiUnit(p.unit)}
                                        style={[styles.chip, kpiUnit === p.unit && styles.chipOn]}
                                    >
                                        <Text style={[styles.chipText, kpiUnit === p.unit && styles.chipTextOn]}>
                                            {p.chip}
                                        </Text>
                                    </Pressable>
                                ))}
                            </View>
                            <TextInput
                                value={kpiTarget}
                                onChangeText={setKpiTarget}
                                placeholder="Target"
                                placeholderTextColor={color.mist}
                                keyboardType="number-pad"
                                style={styles.input}
                            />

                            <Text style={styles.fieldLabel}>Soft pledge (KES)</Text>
                            <TextInput
                                value={amountKes}
                                onChangeText={setAmountKes}
                                placeholder="10000"
                                placeholderTextColor={color.mist}
                                keyboardType="number-pad"
                                style={styles.input}
                            />

                            {error ? <Text style={styles.error}>{error}</Text> : null}

                            <Pressable
                                onPress={() => void handleStart()}
                                disabled={busy}
                                style={[styles.cta, busy && styles.disabled]}
                            >
                                <Text style={styles.ctaText}>{busy ? "Opening…" : "Open commitment"}</Text>
                            </Pressable>
                            <Pressable onPress={() => setMode("pitch")} disabled={busy}>
                                <Text style={styles.secondary}>Back</Text>
                            </Pressable>
                        </View>
                    )}

                    <Text style={styles.footnote}>Soft pledge — not a securities offering or live payment.</Text>
                </Animated.View>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.stone },
    scroll: {
        width: "100%",
        alignSelf: "center",
        paddingHorizontal: 20,
        paddingBottom: 32,
        flexGrow: 1,
        justifyContent: "center",
    },
    frame: { width: "100%", gap: 14, alignItems: "center" },
    brand: {
        fontFamily: font.display,
        fontSize: 40,
        fontWeight: "700",
        letterSpacing: -1.4,
        color: color.charcoal,
    },
    eyebrow: {
        fontFamily: font.bodyBold,
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 1.4,
        textTransform: "uppercase",
        color: color.brass,
        marginTop: -8,
    },
    headline: {
        fontFamily: font.displayMedium,
        fontSize: 22,
        fontWeight: "600",
        color: color.charcoal,
        textAlign: "center",
        letterSpacing: -0.3,
        maxWidth: 340,
        lineHeight: 28,
        marginTop: 4,
    },
    loopRow: { flexDirection: "row", width: "100%", alignItems: "center", marginTop: 8 },
    loopCell: { flex: 1, flexDirection: "row", alignItems: "center" },
    loopLine: { width: 10, height: 1, backgroundColor: color.lineStrong },
    loopNode: {
        flex: 1,
        alignItems: "center",
        gap: 6,
        paddingVertical: 14,
        paddingHorizontal: 4,
        backgroundColor: color.paper,
        borderWidth: 1,
        borderColor: color.line,
        borderRadius: 6,
    },
    loopNodeOn: { borderColor: color.brass, backgroundColor: color.brassSoft },
    mark: { width: 9, height: 9, borderRadius: 5, backgroundColor: color.charcoal },
    markOn: { backgroundColor: color.brass },
    loopLabel: { fontFamily: font.bodyBold, fontSize: 13, fontWeight: "700", color: color.charcoal },
    loopHint: { fontFamily: font.body, fontSize: 10, color: color.mist, textAlign: "center" },
    cta: {
        width: "100%",
        maxWidth: 360,
        backgroundColor: color.charcoal,
        paddingVertical: 16,
        borderRadius: 4,
        alignItems: "center",
        marginTop: 8,
    },
    ctaText: { fontFamily: font.bodyBold, color: color.paper, fontWeight: "700", fontSize: 15 },
    secondary: {
        fontFamily: font.bodyBold,
        fontSize: 13,
        fontWeight: "700",
        color: color.mist,
        paddingVertical: 10,
    },
    disabled: { opacity: 0.5 },
    footnote: {
        fontFamily: font.body,
        fontSize: 11,
        color: color.mist,
        textAlign: "center",
        marginTop: 4,
    },
    form: { width: "100%", maxWidth: 400, gap: 8 },
    formTitle: {
        fontFamily: font.displayMedium,
        fontSize: 20,
        fontWeight: "600",
        color: color.charcoal,
        textAlign: "center",
        marginBottom: 6,
    },
    fieldLabel: {
        fontFamily: font.bodyBold,
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 0.6,
        textTransform: "uppercase",
        color: color.brass,
        marginTop: 6,
    },
    input: {
        borderWidth: 1,
        borderColor: color.lineStrong,
        borderRadius: 4,
        paddingHorizontal: 12,
        paddingVertical: 11,
        color: color.ink,
        backgroundColor: color.paper,
        fontFamily: font.body,
        fontSize: 15,
    },
    row2: { flexDirection: "row", gap: 8 },
    half: { flex: 1 },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    chip: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 4,
        backgroundColor: color.paper,
        borderWidth: 1,
        borderColor: color.line,
    },
    chipOn: { borderColor: color.brass, backgroundColor: color.brassSoft },
    chipText: { fontFamily: font.bodyBold, fontSize: 12, fontWeight: "700", color: color.ink },
    chipTextOn: { color: color.charcoal },
    error: { fontFamily: font.body, fontSize: 13, color: color.danger, marginTop: 4 },
});
