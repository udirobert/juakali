import { useCallback, useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AdminDashboard } from "@/components/jua-kali/admin-dashboard";
import { AgentChat } from "@/components/jua-kali/agent-chat";
import { FidelityBadge } from "@/components/jua-kali/fidelity-badge";
import {
    GlossaryModal,
    HelpMenuButton,
    WelcomeBackBanner,
    useCoachGate,
} from "@/components/jua-kali/help";
import { InvestorCockpit } from "@/components/jua-kali/investor-cockpit";
import {
    InvestorLanding,
    useInvestorOnboardingGate,
} from "@/components/jua-kali/investor-onboarding";
import { Onboarding } from "@/components/jua-kali/onboarding";
import { PublicLedger } from "@/components/jua-kali/public-ledger";
import { SoftIdentityBar } from "@/components/jua-kali/soft-identity";
import { writeCoachDismissed } from "@/components/jua-kali/session-persist";
import { color, font, layout } from "@/components/jua-kali/theme";
import { useProductMode } from "@/lib/product-mode";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

type Screen = "home" | "ledger" | "lab";
type LabScreen = "agent" | "funnel" | "ops";

const labTabs: Array<{ id: LabScreen; label: string }> = [
    { id: "agent", label: "Agent" },
    { id: "funnel", label: "Funnel" },
    { id: "ops", label: "Ops" },
];

function readTabParam(): Screen | null {
    if (Platform.OS !== "web" || typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (tab === "home" || tab === "ledger" || tab === "lab") return tab;
    // Share-card deep link: /?ledger=<slug> opens the ledger tab directly.
    if (params.get("ledger")) return "ledger";
    return null;
}

function writeTabParam(tab: Screen) {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (tab === "home") url.searchParams.delete("tab");
    else url.searchParams.set("tab", tab);
    // The ?ledger= deep link has served its purpose once tabs change.
    url.searchParams.delete("ledger");
    window.history.replaceState({}, "", url.toString());
}

/** Public demo hides Lab unless `?lab=1` (or native __DEV__). */
function useLabUnlocked() {
    const [unlocked, setUnlocked] = useState(() => {
        if (__DEV__ && Platform.OS !== "web") return true;
        return false;
    });

    useEffect(() => {
        if (Platform.OS !== "web" || typeof window === "undefined") return;
        const params = new URLSearchParams(window.location.search);
        if (params.get("lab") === "1") setUnlocked(true);
    }, []);

    return unlocked;
}

export default function Index() {
    const [screen, setScreenState] = useState<Screen>(() => readTabParam() ?? "home");
    const [labScreen, setLabScreen] = useState<LabScreen>("agent");
    const [focusCommitmentId, setFocusCommitmentId] = useState<Id<"commitments"> | undefined>(() => {
        if (Platform.OS !== "web" || typeof window === "undefined") return undefined;
        const c = new URLSearchParams(window.location.search).get("c");
        return c ? (c as Id<"commitments">) : undefined;
    });
    const [glossaryOpen, setGlossaryOpen] = useState(false);
    const [glossaryFocus, setGlossaryFocus] = useState<string | undefined>();
    const [forceCoach, setForceCoach] = useState(false);

    const insets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    const useTopNav = Platform.OS === "web" && width >= 768;
    const product = useProductMode();
    const softAuth = useQuery(api.softAuth.softAuthConfig);
    const requireAuthToAct = Boolean(softAuth?.requireAuthToAct) || product.requireAuthToAct;
    const onboarding = useInvestorOnboardingGate();
    const coach = useCoachGate();
    const labUnlocked = useLabUnlocked();

    const setScreen = useCallback((next: Screen) => {
        setScreenState(next);
        writeTabParam(next);
    }, []);

    const openGlossary = useCallback((focusId?: string) => {
        setGlossaryFocus(focusId);
        setGlossaryOpen(true);
    }, []);

    const hasDealLink = useMemo(() => {
        if (focusCommitmentId) return true;
        if (Platform.OS !== "web" || typeof window === "undefined") return false;
        return Boolean(new URLSearchParams(window.location.search).get("v"));
    }, [focusCommitmentId]);
    const hasLedgerLink = useMemo(() => {
        if (Platform.OS !== "web" || typeof window === "undefined") return false;
        return Boolean(new URLSearchParams(window.location.search).get("ledger"));
    }, []);

    const primaryTabs = useMemo(() => {
        const tabs: Array<{ id: Screen; label: string }> = [
            { id: "home", label: useTopNav ? "My deals" : "Deals" },
            { id: "ledger", label: useTopNav ? "Public ledger" : "Ledger" },
        ];
        if (labUnlocked) tabs.push({ id: "lab", label: "Lab" });
        return tabs;
    }, [labUnlocked, useTopNav]);

    useEffect(() => {
        if (!labUnlocked && screen === "lab") setScreen("home");
    }, [labUnlocked, screen, setScreen]);

    useEffect(() => {
        if (onboarding.showLanding && (hasDealLink || hasLedgerLink)) {
            void onboarding.completeLanding();
        }
    }, [onboarding.showLanding, onboarding.completeLanding, hasDealLink, hasLedgerLink]);

    // Auto coach on first entry this session; suppress while welcome-back is up (avoid double chrome).
    const showCoach =
        (forceCoach || (coach.show && !onboarding.showWelcomeBack)) && coach.ready;

    if (!onboarding.ready) {
        return (
            <View style={styles.boot}>
                <ActivityIndicator color={color.brass} />
            </View>
        );
    }

    if (onboarding.showLanding && !hasDealLink) {
        return (
            <InvestorLanding
                onEnter={(opts) => {
                    if (opts?.commitmentId) setFocusCommitmentId(opts.commitmentId);
                    void onboarding.completeLanding();
                }}
            />
        );
    }

    async function handleDismissWelcome() {
        await onboarding.dismissWelcomeBack();
        await writeCoachDismissed(product.coachSessionScoped);
        setForceCoach(false);
    }

    const nav = (
        <View style={[styles.navInner, useTopNav && styles.navInnerTop]}>
            <View style={[styles.tabRow, useTopNav && styles.tabRowTop]}>
                {primaryTabs.map((tab) => (
                    <TabButton
                        key={tab.id}
                        label={tab.label}
                        active={screen === tab.id}
                        onPress={() => setScreen(tab.id)}
                        top={useTopNav}
                    />
                ))}
            </View>
            {screen === "lab" && labUnlocked ? (
                <View style={styles.labRow}>
                    {labTabs.map((tab) => (
                        <TabButton
                            key={tab.id}
                            label={tab.label}
                            active={labScreen === tab.id}
                            onPress={() => setLabScreen(tab.id)}
                            compact
                            top={useTopNav}
                        />
                    ))}
                </View>
            ) : null}
        </View>
    );

    const helpCluster = (
        <View style={styles.helpWrap}>
            <HelpMenuButton
                onHowItWorks={() => setForceCoach(true)}
                onGlossary={() => openGlossary()}
                onShowIntro={() => {
                    void (async () => {
                        setFocusCommitmentId(undefined);
                        setScreen("home");
                        setForceCoach(false);
                        await onboarding.resetToIntro();
                        coach.reset();
                    })();
                }}
            />
        </View>
    );

    return (
        <View style={styles.container}>
            {useTopNav ? (
                <View style={[styles.topBar, { paddingTop: Math.max(insets.top, 10) }]}>
                    <View style={styles.topBarInner}>
                        <View style={styles.brandBlock}>
                            <Text style={styles.topBrand}>JuaKali</Text>
                            <Text style={styles.topSub}>Deals = act · Ledger = public proof</Text>
                        </View>
                        {nav}
                        <View style={styles.topTrailing}>
                            <SoftIdentityBar compact />
                            <FidelityBadge
                                mode={product}
                                compact
                                onPress={() => openGlossary("soft-pledge")}
                            />
                            {helpCluster}
                        </View>
                    </View>
                </View>
            ) : (
                <View style={[styles.mobileHelpBar, { paddingTop: Math.max(insets.top, 8) }]}>
                    <View style={styles.mobileLead}>
                        <FidelityBadge
                            mode={product}
                            compact
                            onPress={() => openGlossary("soft-pledge")}
                        />
                        <Text style={styles.mobileBridge}>Deals = act · Ledger = proof</Text>
                        <SoftIdentityBar compact />
                    </View>
                    {helpCluster}
                </View>
            )}

            <WelcomeBackBanner
                visible={onboarding.showWelcomeBack}
                onDismiss={() => void handleDismissWelcome()}
                onHowItWorks={() => {
                    void handleDismissWelcome().then(() => setForceCoach(true));
                }}
                onGlossary={() => {
                    void handleDismissWelcome().then(() => openGlossary());
                }}
            />

            <View style={styles.content}>
                {screen === "home" ? (
                    <InvestorCockpit
                        initialCommitmentId={focusCommitmentId}
                        showCoach={showCoach}
                        onDismissCoach={() => {
                            setForceCoach(false);
                            void coach.dismiss();
                        }}
                        onOpenGlossary={openGlossary}
                        onOpenLedger={() => setScreen("ledger")}
                        hideBrand={useTopNav}
                        requireAuthToAct={requireAuthToAct}
                    />
                ) : screen === "ledger" ? (
                    <PublicLedger onOpenGlossary={openGlossary} hideTitleChrome={useTopNav} />
                ) : labScreen === "agent" ? (
                    <AgentChat />
                ) : labScreen === "funnel" ? (
                    <Onboarding onEnterDashboard={() => setLabScreen("ops")} />
                ) : (
                    <AdminDashboard />
                )}
            </View>

            {!useTopNav ? (
                <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
                    {nav}
                </View>
            ) : null}

            <GlossaryModal
                visible={glossaryOpen}
                onClose={() => setGlossaryOpen(false)}
                focusId={glossaryFocus}
            />
        </View>
    );
}

function TabButton({
    label,
    active,
    onPress,
    compact,
    top,
}: {
    label: string;
    active: boolean;
    onPress: () => void;
    compact?: boolean;
    top?: boolean;
}) {
    return (
        <Pressable
            onPress={onPress}
            style={[
                styles.tab,
                top && styles.tabTop,
                compact && styles.tabCompact,
                active && (top ? styles.tabActiveTop : styles.tabActive),
            ]}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
        >
            <Text
                style={[
                    styles.tabText,
                    compact && styles.tabTextCompact,
                    active && styles.tabTextActive,
                ]}
            >
                {label}
            </Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    boot: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: color.stone },
    container: { flex: 1, backgroundColor: color.stone },
    content: { flex: 1 },
    topBar: {
        borderBottomWidth: 1,
        borderBottomColor: color.line,
        backgroundColor: color.paper,
        paddingBottom: 8,
        paddingHorizontal: 16,
        zIndex: 5,
    },
    topBarInner: {
        maxWidth: layout.maxWidth,
        width: "100%",
        alignSelf: "center",
        flexDirection: "row",
        alignItems: "center",
        gap: 16,
        minHeight: 56,
    },
    brandBlock: { gap: 2, minWidth: 140 },
    topBrand: {
        fontFamily: font.display,
        fontSize: 22,
        fontWeight: "700",
        letterSpacing: -0.6,
        color: color.charcoal,
    },
    topSub: { fontFamily: font.body, fontSize: 11, color: color.mist },
    topTrailing: { flexDirection: "row", alignItems: "center", gap: 8 },
    mobileHelpBar: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 14,
        paddingBottom: 6,
        gap: 12,
        zIndex: 5,
    },
    mobileLead: { flex: 1, gap: 4 },
    mobileBridge: {
        fontFamily: font.bodyMedium,
        fontSize: 11,
        color: color.mist,
    },
    helpWrap: { position: "relative", zIndex: 30 },
    navInner: { width: "100%" },
    navInnerTop: { flex: 1 },
    tabBar: {
        borderTopWidth: 1,
        borderTopColor: color.line,
        backgroundColor: color.paper,
    },
    tabRow: {
        flexDirection: "row",
        justifyContent: "center",
        maxWidth: layout.maxWidth,
        width: "100%",
        alignSelf: "center",
        paddingHorizontal: 8,
    },
    tabRowTop: {
        justifyContent: "flex-start",
        paddingHorizontal: 0,
        gap: 4,
    },
    labRow: {
        flexDirection: "row",
        justifyContent: "center",
        gap: 4,
        paddingHorizontal: 12,
        paddingTop: 2,
    },
    tab: {
        flex: 1,
        maxWidth: 160,
        paddingVertical: 14,
        alignItems: "center",
        minHeight: 48,
        justifyContent: "center",
    },
    tabTop: {
        flex: 0,
        paddingHorizontal: 16,
        paddingVertical: 10,
        minHeight: 44,
        maxWidth: undefined,
        borderRadius: 4,
    },
    tabCompact: {
        flex: 0,
        paddingHorizontal: 14,
        paddingVertical: 8,
        minHeight: 36,
    },
    tabActive: {
        borderTopWidth: 2,
        borderTopColor: color.brass,
    },
    tabActiveTop: {
        backgroundColor: color.brassSoft,
    },
    tabText: {
        fontFamily: font.bodyBold,
        color: color.mist,
        fontSize: 13,
        fontWeight: "700",
        letterSpacing: 0.3,
    },
    tabTextCompact: { fontSize: 11 },
    tabTextActive: { color: color.charcoal },
});
