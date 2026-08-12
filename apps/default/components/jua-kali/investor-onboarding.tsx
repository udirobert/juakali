import { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeIn } from "react-native-reanimated";
import * as SecureStore from "expo-secure-store";
import { useMutation } from "convex/react";

import { api } from "@/convex/_generated/api";
import { color, font, layout } from "@/components/jua-kali/theme";

/** Bump when first-run UX changes so returning demo viewers see the new landing once. */
const STORAGE_KEY = "juakali_investor_onboarded_v2";

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

/** Single landing: problem + loop + one CTA that seeds and enters product. */
export function InvestorLanding({ onEnter }: { onEnter: () => void }) {
    const insets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    const compact = width < 420;
    const seedInvestDemo = useMutation(api.invest.seedInvestDemo);
    const [busy, setBusy] = useState(false);

    async function seeCommitment() {
        setBusy(true);
        try {
            await seedInvestDemo({});
        } catch {
            // enter anyway
        } finally {
            setBusy(false);
        }
        onEnter();
    }

    return (
        <View style={[styles.screen, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 20 }]}>
            <Animated.View entering={FadeIn.duration(280)} style={[styles.frame, { maxWidth: layout.maxWidth }]}>
                <Text style={styles.brand}>JuaKali</Text>
                <Text style={styles.eyebrow}>Invest in public</Text>

                <Text style={styles.headline}>
                    {compact ? "You’re busy. Ventures aren’t." : "You’re busy. The venture still needs a weekly operator."}
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

                <View style={styles.primitiveRow}>
                    {["Note", "Approve", "KPI", "Digest", "Ledger"].map((p) => (
                        <View key={p} style={styles.primitive}>
                            <Text style={styles.primitiveText}>{p}</Text>
                        </View>
                    ))}
                </View>

                <Pressable
                    onPress={() => void seeCommitment()}
                    disabled={busy}
                    style={[styles.cta, busy && styles.disabled]}
                    accessibilityRole="button"
                    accessibilityLabel="See a commitment"
                >
                    <Text style={styles.ctaText}>{busy ? "Loading…" : "See a commitment"}</Text>
                </Pressable>

                <Text style={styles.footnote}>Demo only — not securities or live payments.</Text>
            </Animated.View>
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
    frame: { width: "100%", gap: 16, alignItems: "center" },
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
    primitiveRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "center" },
    primitive: {
        paddingHorizontal: 10,
        paddingVertical: 7,
        borderRadius: 4,
        backgroundColor: color.paper,
        borderWidth: 1,
        borderColor: color.line,
    },
    primitiveText: { fontFamily: font.bodyBold, fontSize: 11, fontWeight: "700", color: color.charcoal },
    cta: {
        width: "100%",
        maxWidth: 320,
        backgroundColor: color.charcoal,
        paddingVertical: 16,
        borderRadius: 4,
        alignItems: "center",
        marginTop: 8,
    },
    ctaText: { fontFamily: font.bodyBold, color: color.paper, fontWeight: "700", fontSize: 15 },
    disabled: { opacity: 0.5 },
    footnote: {
        fontFamily: font.body,
        fontSize: 11,
        color: color.mist,
        textAlign: "center",
        marginTop: 4,
    },
});
