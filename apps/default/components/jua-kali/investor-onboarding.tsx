import { useCallback, useEffect, useState } from "react";
import {
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
    type ViewProps,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
    FadeIn,
    FadeInDown,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withTiming,
} from "react-native-reanimated";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { Id } from "@/convex/_generated/dataModel";

import { api } from "@/convex/_generated/api";
import {
    clearDemoGates,
    hasFreshParam,
    markOriented,
    readOnboarded,
    shouldShowWelcomeBack,
    stripFreshParam,
    writeOnboarded,
} from "@/components/jua-kali/session-persist";
import { useProductMode, SOFT_RETURN_MS } from "@/lib/product-mode";
import { SoftIdentityBar } from "@/components/jua-kali/soft-identity";
import { LivingSun } from "@/components/jua-kali/living-sun";
import { IconArrowRight, IconCapital, IconPen, IconTrend } from "@/components/jua-kali/icons";
import { Button, Card, Chip, Input, SectionLabel } from "@/components/jua-kali/ui";
import { color, font, layout, motion, sun } from "@/components/jua-kali/theme";

type KpiUnit = "meetings" | "revenue_kes" | "jobs";

export function useInvestorOnboardingGate() {
    const product = useProductMode();
    const { isAuthenticated } = useConvexAuth();
    const prefs = useQuery(api.softAuth.getMyPrefs, isAuthenticated ? {} : "skip");
    const setPrefs = useMutation(api.softAuth.setMyPrefs);
    const [ready, setReady] = useState(false);
    const [showLanding, setShowLanding] = useState(false);
    const [showWelcomeBack, setShowWelcomeBack] = useState(false);

    useEffect(() => {
        void (async () => {
            if (hasFreshParam()) {
                await clearDemoGates();
                stripFreshParam();
                if (isAuthenticated) {
                    await setPrefs({
                        onboarded: false,
                        coachDismissed: false,
                        lastOrientedAt: null,
                    }).catch(() => undefined);
                }
                setShowLanding(true);
                setShowWelcomeBack(false);
                setReady(true);
                return;
            }

            // Authenticated: prefer server prefs when loaded
            if (isAuthenticated) {
                if (prefs === undefined) {
                    setReady(false);
                    return;
                }
                if (prefs === null || !prefs.onboarded) {
                    const localDone = await readOnboarded();
                    if (localDone) {
                        await setPrefs({
                            onboarded: true,
                            lastOrientedAt: Date.now(),
                        }).catch(() => undefined);
                        setShowLanding(false);
                        setShowWelcomeBack(false);
                        setReady(true);
                        return;
                    }
                    setShowLanding(true);
                    setShowWelcomeBack(false);
                    setReady(true);
                    return;
                }

                let welcome = false;
                if (product.teaching === "loud") {
                    welcome = await shouldShowWelcomeBack("loud");
                } else if (product.teaching === "soft-return") {
                    const last = prefs.lastOrientedAt;
                    welcome = last === null || Date.now() - last >= SOFT_RETURN_MS;
                }
                setShowLanding(false);
                setShowWelcomeBack(welcome);
                setReady(true);
                return;
            }

            const onboarded = await readOnboarded();
            if (!onboarded) {
                setShowLanding(true);
                setShowWelcomeBack(false);
                setReady(true);
                return;
            }

            const welcome = await shouldShowWelcomeBack(product.teaching);
            setShowLanding(false);
            setShowWelcomeBack(welcome);
            setReady(true);
        })();
    }, [product.teaching, isAuthenticated, prefs, setPrefs]);

    const completeLanding = useCallback(async () => {
        await writeOnboarded();
        await markOriented(product.teaching);
        if (isAuthenticated) {
            await setPrefs({
                onboarded: true,
                lastOrientedAt: Date.now(),
            }).catch(() => undefined);
        }
        setShowLanding(false);
        setShowWelcomeBack(false);
    }, [product.teaching, isAuthenticated, setPrefs]);

    const dismissWelcomeBack = useCallback(async () => {
        await markOriented(product.teaching);
        if (isAuthenticated) {
            await setPrefs({ lastOrientedAt: Date.now() }).catch(() => undefined);
        }
        setShowWelcomeBack(false);
    }, [product.teaching, isAuthenticated, setPrefs]);

    /** Same effect as `?fresh=1` — back to pitch without a URL hack. */
    const resetToIntro = useCallback(async () => {
        await clearDemoGates();
        if (isAuthenticated) {
            await setPrefs({
                onboarded: false,
                coachDismissed: false,
                lastOrientedAt: null,
            }).catch(() => undefined);
        }
        setShowLanding(true);
        setShowWelcomeBack(false);
    }, [isAuthenticated, setPrefs]);

    return {
        ready,
        /** @deprecated use showLanding */
        show: showLanding,
        showLanding,
        showWelcomeBack,
        complete: completeLanding,
        completeLanding,
        dismissWelcomeBack,
        resetToIntro,
        product,
    };
}

const kpiPresets: Array<{ unit: KpiUnit; label: string; chip: string }> = [
    { unit: "meetings", label: "Meetings booked", chip: "Meetings" },
    { unit: "jobs", label: "Jobs completed", chip: "Jobs" },
    { unit: "revenue_kes", label: "Revenue (KES)", chip: "Revenue" },
];

function ledgerTypeLabel(type: string) {
    if (type === "pledge") return "Capital";
    if (type === "checkin") return "KPI";
    if (type === "digest") return "Digest";
    return "Action";
}

function ledgerWhen(ts: number) {
    return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type LedgerArtifactEvent = {
    id: string;
    type: string;
    summary: string;
    createdAt: number;
};

/** The pitch artifact: the public ledger itself, live. */
function LedgerArtifact() {
    const ledger = useQuery(api.invest.publicLedger, { limit: 3 });
    const events = (ledger?.events ?? []) as LedgerArtifactEvent[];

    return (
        <Card variant="artifact" style={styles.artifact}>
            <View style={styles.artifactHead}>
                <Text style={styles.artifactTitle}>Public ledger</Text>
                <Text style={styles.artifactLive}>{ledger ? "Live" : "Loading…"}</Text>
            </View>
            {events.length === 0 ? (
                <Text style={styles.artifactEmpty}>
                    Pledges, KPIs, and digests land here — watch a deal to see them appear.
                </Text>
            ) : (
                events.map((event, i) => (
                    <View
                        key={event.id}
                        style={[styles.artifactRow, i > 0 && styles.artifactRowBorder]}
                    >
                        <Text style={styles.artifactType}>{ledgerTypeLabel(event.type)}</Text>
                        <Text style={styles.artifactSummary} numberOfLines={1}>
                            {event.summary}
                        </Text>
                        <Text style={styles.artifactWhen}>{ledgerWhen(event.createdAt)}</Text>
                    </View>
                ))
            )}
        </Card>
    );
}

/**
 * The arrival of the brand — a brass sun rising over a horizon hairline.
 * The one authored moment on the landing: the sun lifts above the line while
 * its rays ignite from dawn toward morning (progress 0 → 0.35). On web the
 * stage answers the pointer with a few pixels of parallax.
 */
function HeroStage({ compact }: { compact: boolean }) {
    const reduceMotion = useReducedMotion();
    const sunSize = compact ? 76 : 92;
    const [progress, setProgress] = useState(reduceMotion ? 0.35 : 0);
    const [stageWidth, setStageWidth] = useState(0);

    useEffect(() => {
        if (reduceMotion) return;
        const timer = setTimeout(() => setProgress(0.35), 100);
        return () => clearTimeout(timer);
    }, [reduceMotion]);

    const rise = useSharedValue(reduceMotion ? 0 : 1);
    const parallaxX = useSharedValue(0);

    useEffect(() => {
        if (reduceMotion) return;
        rise.value = withTiming(0, { duration: motion.hero });
    }, [rise, reduceMotion]);

    const sunStyle = useAnimatedStyle(() => ({
        transform: [
            { translateY: rise.value * sunSize * 0.55 },
            { translateX: parallaxX.value * 5 },
        ],
    }));
    const lineStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: parallaxX.value * -3 }],
    }));

    // Web-only pointer answer — a few pixels, capped by the worklet math above.
    const onMouseMove = Platform.select({
        web: (event: { locationX?: number }) => {
            if (reduceMotion || !stageWidth || event.locationX == null) return;
            parallaxX.value = (event.locationX / stageWidth - 0.5) * 2;
        },
        default: undefined,
    });

    // Web-only pointer answer — a few pixels, capped by the worklet math above.
    const webProps = Platform.select({
        web: { onMouseMove } as unknown as ViewProps,
        default: {} as ViewProps,
    });

    return (
        <View
            style={[styles.stage, { height: sunSize * 1.55 }]}
            onLayout={(event) => setStageWidth(event.nativeEvent.layout.width)}
            {...webProps}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
        >
            <Animated.View style={[styles.stageLine, lineStyle]} />
            <Animated.View
                style={[
                    styles.stageSun,
                    sunStyle,
                    { width: sunSize, height: sunSize, top: sunSize * 0.55 - sunSize * 0.62 },
                ]}
            >
                <LivingSun progress={progress} size={sunSize} />
            </Animated.View>
        </View>
    );
}

/** The proof strip — three glyph-marked facts on hairlines, not another box. */
function ProofStrip() {
    const items = [
        { icon: <IconCapital size={15} color={color.brassDeep} />, label: "Soft pledges" },
        { icon: <IconTrend size={15} color={color.brassDeep} />, label: "Weekly KPIs" },
        { icon: <IconPen size={15} color={color.brassDeep} />, label: "Public digests" },
    ];
    return (
        <View style={styles.proofStrip}>
            {items.map((item, i) => (
                <View key={item.label} style={[styles.proofItem, i > 0 && styles.proofItemBorder]}>
                    {item.icon}
                    <Text style={styles.proofLabel}>{item.label}</Text>
                </View>
            ))}
        </View>
    );
}

export function InvestorLanding({
    onEnter,
}: {
    onEnter: (opts?: { commitmentId?: Id<"commitments"> }) => void;
}) {
    const insets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    const compact = width < 420;
    const reduceMotion = useReducedMotion();
    const { isAuthenticated } = useConvexAuth();
    const startCommitment = useMutation(api.invest.startCommitment);
    const seedInvestDemo = useMutation(api.invest.seedInvestDemo);
    const softAuth = useQuery(api.softAuth.softAuthConfig);
    const requireAuth = Boolean(softAuth?.requireAuthToAct);

    const [mode, setMode] = useState<"pitch" | "form" | "save">("pitch");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    /** Commitment created in the "save your pledge" step. */
    const [saveCommitmentId, setSaveCommitmentId] = useState<Id<"commitments"> | null>(null);
    const [saveName, setSaveName] = useState<string | null>(null);

    const [investorName, setInvestorName] = useState("");
    const [investorEmail, setInvestorEmail] = useState("");
    const [ventureName, setVentureName] = useState("");
    const [craftText, setCraftText] = useState("");
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
                locationText: "Kenya",
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
            // Capture identity at the moment of intent: save the pledge via
            // magic link / Google before entering the app.
            if (!isAuthenticated) {
                setSaveCommitmentId(result.commitmentId);
                setSaveName(investorName.trim().split(/\s+/)[0] ?? null);
                setMode("save");
                return;
            }
            onEnter({ commitmentId: result.commitmentId });
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not start commitment.");
        } finally {
            setBusy(false);
        }
    }

    // Once the save step authenticates, continue into the app with the deal focused.
    useEffect(() => {
        if (mode !== "save" || !isAuthenticated || !saveCommitmentId) return;
        onEnter({ commitmentId: saveCommitmentId });
    }, [mode, isAuthenticated, saveCommitmentId, onEnter]);

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
                <Animated.View entering={FadeIn.duration(motion.base)} style={styles.frame}>
                    <HeroStage compact={compact} />
                    <Animated.View
                        entering={reduceMotion ? undefined : FadeInDown.duration(motion.base).delay(40)}
                        style={styles.brandBlock}
                    >
                        <Text style={styles.brand}>JuaKali</Text>
                        <Text style={styles.eyebrow}>Invest in public</Text>
                    </Animated.View>

                    {requireAuth ? (
                        <View style={styles.authBlock}>
                            <SoftIdentityBar forceOpen />
                        </View>
                    ) : null}

                    {mode === "pitch" ? (
                        <>
                            <Animated.Text
                                entering={reduceMotion ? undefined : FadeInDown.duration(motion.base).delay(90)}
                                style={[styles.headline, compact && styles.headlineCompact]}
                            >
                                You’re busy. Your capital shouldn’t be.
                            </Animated.Text>
                            <Animated.Text
                                entering={reduceMotion ? undefined : FadeInDown.duration(motion.base).delay(140)}
                                style={styles.subhead}
                            >
                                Jua, your agent, mentors each venture weekly — tracking KPIs, writing
                                digests, nudging follow-ups. Every step lands on a public ledger you
                                can share.
                            </Animated.Text>

                            <Animated.View
                                entering={reduceMotion ? undefined : FadeInDown.duration(motion.base).delay(190)}
                                style={styles.artifactBlock}
                            >
                                <SectionLabel>The ledger, live</SectionLabel>
                                <LedgerArtifact />
                            </Animated.View>

                            <Animated.View
                                entering={reduceMotion ? undefined : FadeInDown.duration(motion.base).delay(240)}
                                style={styles.ctaBlock}
                            >
                                <Button
                                    label={busy ? "Opening…" : "Watch a deal come alive"}
                                    onPress={() => void handleExample()}
                                    disabled={busy}
                                    icon={<IconArrowRight size={15} color={color.paper} />}
                                    style={styles.ctaBlockFull}
                                    accessibilityHint="Loads example deals and opens My deals"
                                />
                                <Pressable onPress={() => setMode("form")} accessibilityRole="button">
                                    <Text style={styles.secondary}>or start your own commitment →</Text>
                                </Pressable>
                                <ProofStrip />
                            </Animated.View>
                        </>
                    ) : null}

                    {mode === "form" ? (
                        <View style={styles.form}>
                            <Text style={styles.formTitle}>Start a commitment</Text>
                            <Text style={styles.formSub}>Three things. The agent handles the rest.</Text>

                            <Text style={styles.fieldLabel}>You</Text>
                            <Input
                                value={investorName}
                                onChangeText={setInvestorName}
                                placeholder="Your name"
                            />
                            <Input
                                value={investorEmail}
                                onChangeText={setInvestorEmail}
                                placeholder="Email (optional)"
                                keyboardType="email-address"
                                autoCapitalize="none"
                            />

                            <Text style={styles.fieldLabel}>The venture</Text>
                            <Input
                                value={ventureName}
                                onChangeText={setVentureName}
                                placeholder="Business name"
                            />
                            <Input
                                value={craftText}
                                onChangeText={setCraftText}
                                placeholder="Craft (optional — e.g. metalwork, tailoring)"
                            />

                            <Text style={styles.fieldLabel}>The deal</Text>
                            <View style={styles.chipRow}>
                                {kpiPresets.map((p) => (
                                    <Chip
                                        key={p.unit}
                                        label={p.chip}
                                        active={kpiUnit === p.unit}
                                        onPress={() => setKpiUnit(p.unit)}
                                    />
                                ))}
                            </View>
                            <View style={styles.row2}>
                                <Input
                                    value={kpiTarget}
                                    onChangeText={setKpiTarget}
                                    placeholder="KPI target"
                                    keyboardType="number-pad"
                                    style={styles.half}
                                />
                                <Input
                                    value={amountKes}
                                    onChangeText={setAmountKes}
                                    placeholder="Soft pledge (KES)"
                                    keyboardType="number-pad"
                                    style={styles.half}
                                />
                            </View>

                            {error ? <Text style={styles.error}>{error}</Text> : null}

                            <Button
                                label={busy ? "Opening…" : "Open commitment"}
                                onPress={() => void handleStart()}
                                disabled={busy}
                                icon={<IconArrowRight size={15} color={color.paper} />}
                                style={styles.ctaBlockFull}
                            />
                            <Pressable onPress={() => setMode("pitch")} disabled={busy}>
                                <Text style={styles.secondary}>← Back</Text>
                            </Pressable>
                        </View>
                    ) : null}

                    {mode === "save" ? (
                        <View style={styles.form}>
                            <Text style={styles.formTitle}>
                                {saveName ? `Save your pledge, ${saveName}` : "Save your pledge"}
                            </Text>
                            <Text style={styles.formSub}>
                                Your commitment is recorded. Add your email and this deal follows you —
                                across sessions and devices.
                            </Text>
                            <SoftIdentityBar
                                forceOpen
                                heading="Keep this deal"
                                initialEmail={investorEmail}
                            />
                            <Pressable
                                onPress={() => onEnter({ commitmentId: saveCommitmentId ?? undefined })}
                            >
                                <Text style={styles.secondary}>Skip for now — open My deals</Text>
                            </Pressable>
                        </View>
                    ) : null}

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
    // Hero stage — the sun rises over a horizon hairline.
    stage: {
        width: "100%",
        maxWidth: 420,
        overflow: "hidden",
        justifyContent: "flex-start",
    },
    stageLine: {
        position: "absolute",
        left: -10,
        right: -10,
        top: "62%",
        height: 1,
        backgroundColor: sun.horizon,
    },
    stageSun: {
        position: "absolute",
        alignSelf: "center",
    },
    brandBlock: { alignItems: "center" },
    authBlock: { width: "100%", maxWidth: 400 },
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
        color: color.brassDeep,
        marginTop: -8,
    },
    headline: {
        fontFamily: font.display,
        fontSize: 30,
        fontWeight: "700",
        color: color.charcoal,
        textAlign: "center",
        letterSpacing: -0.6,
        maxWidth: 380,
        lineHeight: 34,
        marginTop: 4,
    },
    headlineCompact: { fontSize: 24, lineHeight: 28, maxWidth: 300 },
    subhead: {
        fontFamily: font.body,
        fontSize: 13,
        lineHeight: 19,
        color: color.ink,
        textAlign: "center",
        maxWidth: 360,
    },
    artifactBlock: { width: "100%", alignItems: "center", gap: 8 },
    // Live ledger artifact — the pitch is the product itself
    artifact: {
        width: "100%",
        maxWidth: 420,
        gap: 0,
        padding: 14,
    },
    artifactHead: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingBottom: 8,
        borderBottomWidth: 1,
        borderBottomColor: color.line,
    },
    artifactTitle: {
        fontFamily: font.displayMedium,
        fontSize: 16,
        fontWeight: "600",
        color: color.charcoal,
    },
    artifactLive: {
        fontFamily: font.bodyBold,
        fontSize: 9,
        fontWeight: "700",
        letterSpacing: 0.8,
        textTransform: "uppercase",
        color: color.success,
    },
    artifactEmpty: {
        fontFamily: font.body,
        fontSize: 12,
        lineHeight: 17,
        color: color.mist,
        textAlign: "center",
        paddingVertical: 16,
    },
    artifactRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingVertical: 9,
    },
    artifactRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
    artifactType: {
        fontFamily: font.bodyBold,
        fontSize: 9,
        fontWeight: "700",
        letterSpacing: 0.6,
        textTransform: "uppercase",
        color: color.brassDeep,
        width: 52,
    },
    artifactSummary: {
        flex: 1,
        fontFamily: font.body,
        fontSize: 12,
        lineHeight: 17,
        color: color.ink,
    },
    artifactWhen: { fontFamily: font.bodyMedium, fontSize: 11, color: color.mist },
    ctaBlock: { width: "100%", alignItems: "center", gap: 2 },
    ctaBlockFull: { width: "100%", maxWidth: 360 },
    secondary: {
        fontFamily: font.bodyBold,
        fontSize: 13,
        fontWeight: "700",
        color: color.mist,
        paddingVertical: 10,
    },
    // The proof strip — hairline-separated facts, not another box.
    proofStrip: {
        flexDirection: "row",
        marginTop: 18,
        paddingTop: 14,
        borderTopWidth: 1,
        borderTopColor: color.line,
    },
    proofItem: { flex: 1, alignItems: "center", gap: 6 },
    proofItemBorder: { borderLeftWidth: 1, borderLeftColor: color.line },
    proofLabel: {
        fontFamily: font.bodyBold,
        fontSize: 10,
        fontWeight: "700",
        letterSpacing: 0.5,
        textTransform: "uppercase",
        color: color.mist,
    },
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
        marginBottom: 2,
    },
    formSub: {
        fontFamily: font.body,
        fontSize: 12,
        color: color.mist,
        textAlign: "center",
        marginBottom: 6,
    },
    fieldLabel: {
        fontFamily: font.bodyBold,
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 0.6,
        textTransform: "uppercase",
        color: color.brassDeep,
        marginTop: 6,
    },
    row2: { flexDirection: "row", gap: 8 },
    half: { flex: 1 },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    error: { fontFamily: font.body, fontSize: 13, color: color.danger, marginTop: 4 },
});
