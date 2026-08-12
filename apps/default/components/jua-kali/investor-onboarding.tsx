import { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import * as SecureStore from "expo-secure-store";
import { useMutation } from "convex/react";

import { api } from "@/convex/_generated/api";
import { color, font, layout } from "@/components/jua-kali/theme";

const STORAGE_KEY = "juakali_investor_onboarded_v1";

async function readOnboarded(): Promise<boolean> {
    try {
        if (Platform.OS === "web" && typeof localStorage !== "undefined") {
            return localStorage.getItem(STORAGE_KEY) === "1";
        }
        const value = await SecureStore.getItemAsync(STORAGE_KEY);
        return value === "1";
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
        // ignore — onboarding can repeat
    }
}

type Step = 0 | 1 | 2;

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

/** First-run: problem → loop → try. No essays. */
export function InvestorOnboarding({ onDone }: { onDone: () => void }) {
    const insets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    const compact = width < 420;
    const seedInvestDemo = useMutation(api.invest.seedInvestDemo);
    const [step, setStep] = useState<Step>(0);
    const [seeding, setSeeding] = useState(false);

    async function finish(seed: boolean) {
        if (seed) {
            setSeeding(true);
            try {
                await seedInvestDemo({});
            } catch {
                // still enter — empty home is ok
            } finally {
                setSeeding(false);
            }
        }
        onDone();
    }

    return (
        <View style={[styles.screen, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 }]}>
            <View style={[styles.frame, { maxWidth: layout.maxWidth }]}>
                <Text style={styles.brand}>JuaKali</Text>

                {step === 0 ? (
                    <Animated.View key="s0" entering={FadeIn.duration(220)} exiting={FadeOut.duration(120)} style={styles.panel}>
                        <View style={styles.glyph}>
                            <View style={styles.glyphRing} />
                            <View style={[styles.glyphRing, styles.glyphRingSm]} />
                        </View>
                        <Text style={styles.headline}>
                            {compact ? "You’re busy. Ventures aren’t." : "You’re busy. The venture still needs a weekly operator."}
                        </Text>
                        <Text style={styles.sub}>Soft pledges. Hard KPIs. Public proof.</Text>
                    </Animated.View>
                ) : null}

                {step === 1 ? (
                    <Animated.View key="s1" entering={FadeIn.duration(220)} exiting={FadeOut.duration(120)} style={styles.panel}>
                        <Text style={styles.kicker}>How it runs</Text>
                        <View style={styles.loopRow}>
                            {[
                                { label: "You", mark: "note" },
                                { label: "Agent", mark: "work" },
                                { label: "Ledger", mark: "proof" },
                            ].map((node, i) => (
                                <View key={node.label} style={styles.loopCell}>
                                    {i > 0 ? <View style={styles.loopLine} /> : null}
                                    <View style={[styles.loopNode, node.label === "Agent" && styles.loopNodeOn]}>
                                        <View style={[styles.dot, node.label === "Agent" && styles.dotOn]} />
                                        <Text style={styles.loopLabel}>{node.label}</Text>
                                        {!compact ? <Text style={styles.loopMark}>{node.mark}</Text> : null}
                                    </View>
                                </View>
                            ))}
                        </View>
                        <View style={styles.chips}>
                            {["Note", "Approve", "KPI", "Digest", "Ledger"].map((p) => (
                                <View key={p} style={styles.chip}>
                                    <Text style={styles.chipText}>{p}</Text>
                                </View>
                            ))}
                        </View>
                    </Animated.View>
                ) : null}

                {step === 2 ? (
                    <Animated.View key="s2" entering={FadeIn.duration(220)} exiting={FadeOut.duration(120)} style={styles.panel}>
                        <Text style={styles.headline}>Try one commitment</Text>
                        <Text style={styles.sub}>Seed loads sample ventures. Then email the agent once.</Text>
                    </Animated.View>
                ) : null}

                <View style={styles.pager}>
                    {[0, 1, 2].map((i) => (
                        <View key={i} style={[styles.dotPager, step === i && styles.dotPagerOn]} />
                    ))}
                </View>

                <View style={styles.actions}>
                    {step < 2 ? (
                        <Pressable onPress={() => setStep((step + 1) as Step)} style={styles.btnPrimary}>
                            <Text style={styles.btnPrimaryText}>Next</Text>
                        </Pressable>
                    ) : (
                        <>
                            <Pressable
                                onPress={() => void finish(true)}
                                disabled={seeding}
                                style={[styles.btnPrimary, seeding && styles.disabled]}
                            >
                                <Text style={styles.btnPrimaryText}>{seeding ? "…" : "Seed & enter"}</Text>
                            </Pressable>
                            <Pressable onPress={() => void finish(false)}>
                                <Text style={styles.skip}>Skip</Text>
                            </Pressable>
                        </>
                    )}
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: color.stone,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 20,
    },
    frame: { width: "100%", gap: 20, alignItems: "center" },
    brand: {
        fontFamily: font.display,
        fontSize: 32,
        fontWeight: "700",
        letterSpacing: -1,
        color: color.charcoal,
    },
    panel: { width: "100%", gap: 14, alignItems: "center", minHeight: 200, justifyContent: "center" },
    glyph: { width: 72, height: 72, alignItems: "center", justifyContent: "center", marginBottom: 4 },
    glyphRing: {
        position: "absolute",
        width: 64,
        height: 64,
        borderRadius: 32,
        borderWidth: 1.5,
        borderColor: color.brass,
        opacity: 0.55,
    },
    glyphRingSm: { width: 36, height: 36, borderRadius: 18, opacity: 0.95 },
    headline: {
        fontFamily: font.displayMedium,
        fontSize: 22,
        fontWeight: "600",
        color: color.charcoal,
        textAlign: "center",
        letterSpacing: -0.3,
        maxWidth: 340,
        lineHeight: 28,
    },
    sub: {
        fontFamily: font.body,
        fontSize: 14,
        color: color.mist,
        textAlign: "center",
        maxWidth: 300,
        lineHeight: 20,
    },
    kicker: {
        fontFamily: font.bodyBold,
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 1.2,
        textTransform: "uppercase",
        color: color.brass,
    },
    loopRow: { flexDirection: "row", width: "100%", alignItems: "center" },
    loopCell: { flex: 1, flexDirection: "row", alignItems: "center" },
    loopLine: { width: 10, height: 1, backgroundColor: color.lineStrong },
    loopNode: {
        flex: 1,
        alignItems: "center",
        gap: 6,
        paddingVertical: 14,
        backgroundColor: color.paper,
        borderWidth: 1,
        borderColor: color.line,
        borderRadius: 6,
    },
    loopNodeOn: { borderColor: color.brass, backgroundColor: color.brassSoft },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.charcoal },
    dotOn: { backgroundColor: color.brass },
    loopLabel: { fontFamily: font.bodyBold, fontSize: 12, fontWeight: "700", color: color.charcoal },
    loopMark: { fontFamily: font.body, fontSize: 10, color: color.mist },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "center" },
    chip: {
        paddingHorizontal: 10,
        paddingVertical: 7,
        borderRadius: 4,
        backgroundColor: color.paper,
        borderWidth: 1,
        borderColor: color.line,
    },
    chipText: { fontFamily: font.bodyBold, fontSize: 11, fontWeight: "700", color: color.charcoal },
    pager: { flexDirection: "row", gap: 6 },
    dotPager: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.lineStrong },
    dotPagerOn: { backgroundColor: color.brass, width: 16 },
    actions: { width: "100%", gap: 10, alignItems: "center" },
    btnPrimary: {
        width: "100%",
        maxWidth: 320,
        backgroundColor: color.charcoal,
        paddingVertical: 14,
        borderRadius: 4,
        alignItems: "center",
    },
    btnPrimaryText: { fontFamily: font.bodyBold, color: color.paper, fontWeight: "700", fontSize: 14 },
    disabled: { opacity: 0.5 },
    skip: {
        fontFamily: font.bodyBold,
        fontSize: 13,
        fontWeight: "700",
        color: color.mist,
        paddingVertical: 8,
    },
});
