import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
    useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useConvexAuth, useMutation, useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import {
    readCoachDismissed,
    writeCoachDismissed,
    markOriented,
} from "@/components/jua-kali/session-persist";
import { useProductMode } from "@/lib/product-mode";
import { color, font, layout } from "@/components/jua-kali/theme";

export type GlossaryTerm = {
    id: string;
    label: string;
    short: string;
    body: string;
};

export const GLOSSARY: GlossaryTerm[] = [
    {
        id: "soft-pledge",
        label: "Soft pledge",
        short: "Intent to back a venture — not a payment or security.",
        body: "A soft pledge records how much you intend to back a named venture. This demo does not move money, open escrow, or offer securities.",
    },
    {
        id: "kpi",
        label: "KPI",
        short: "The hard metric you track (meetings, revenue, jobs).",
        body: "A key performance indicator for the venture — meetings booked, jobs completed, or revenue in KES — with a target you set up front.",
    },
    {
        id: "digest",
        label: "Digest",
        short: "Short agent summary of what moved.",
        body: "A concise update the agent drafts after actions run: what changed, what it means, and what to do next. Cadence is usually weekly (next digest date on the scorecard).",
    },
    {
        id: "ledger",
        label: "Public ledger",
        short: "Public feed of pledges, KPIs, and digests.",
        body: "A transparent timeline anyone can read: capital (pledges), KPI check-ins, and digests. Use My deals to act; the ledger is the proof.",
    },
    {
        id: "queue-approve",
        label: "Send → Approve",
        short: "You draft; nothing runs until you approve.",
        body: "Write a note to Jua, the agent, then approve the queued message — or email juakali@agentmail.to. In-app tools (KPI, digest, ledger, reply) only run after approval; inbound mail uses the same path.",
    },
    {
        id: "peers",
        label: "Similar ventures",
        short: "Peer median for the same KPI among active deals.",
        body: "A simple benchmark: the median KPI total among other active ventures in this demo. Not a score of the agent or of you.",
    },
    {
        id: "cadence",
        label: "Next digest",
        short: "When the next weekly digest is due — not a calendar sync.",
        body: "Shows the next digest due date (typically Friday). This is product cadence, not Google Calendar or Outlook sync. ICS / calendar connect can come later.",
    },
    {
        id: "agentmail",
        label: "AgentMail",
        short: "Live agent inbox — email juakali@agentmail.to or use in-app notes.",
        body: "In-app notes still use queue → approve. You can also email juakali@agentmail.to; inbound is verified (Svix) and runs the same KPI / digest / ledger path. Optional subject tag: venture:<slug>. Capital stays soft (not escrow). Gmail for the human investor is still later.",
    },
    {
        id: "soft-identity",
        label: "Sign in",
        short: "Email magic link — deals follow you across sessions.",
        body: "Sign in with a magic link (or Google on web). Optional on demo builds; required when the deployment enforces identity before acting. Links your account to an investor profile so your deals persist.",
    },
];

export const HOW_IT_WORKS_STEPS = [
    {
        n: "1",
        title: "Open a deal",
        body: "Pick a venture on My deals — or start a soft pledge if you're empty.",
    },
    {
        n: "2",
        title: "Send a note to Jua",
        body: "Queue it and approve, or email juakali@agentmail.to. Nothing runs until you approve.",
    },
    {
        n: "3",
        title: "Check public proof",
        body: "The same pledge, KPI, and digest events appear on the public ledger.",
    },
] as const;

export function useCoachGate() {
    const product = useProductMode();
    const { isAuthenticated } = useConvexAuth();
    const prefs = useQuery(api.softAuth.getMyPrefs, isAuthenticated ? {} : "skip");
    const setPrefs = useMutation(api.softAuth.setMyPrefs);
    const [ready, setReady] = useState(false);
    const [show, setShow] = useState(false);

    useEffect(() => {
        void (async () => {
            if (isAuthenticated) {
                if (prefs === undefined) {
                    setReady(false);
                    return;
                }
                if (prefs?.coachDismissed) {
                    setShow(false);
                    setReady(true);
                    return;
                }
            }
            const dismissed = await readCoachDismissed(product.coachSessionScoped);
            setShow(!dismissed);
            setReady(true);
        })();
    }, [product.coachSessionScoped, isAuthenticated, prefs]);

    const dismiss = useCallback(async () => {
        await writeCoachDismissed(product.coachSessionScoped);
        await markOriented(product.teaching);
        if (isAuthenticated) {
            await setPrefs({
                coachDismissed: true,
                lastOrientedAt: Date.now(),
            }).catch(() => undefined);
        }
        setShow(false);
    }, [product.coachSessionScoped, product.teaching, isAuthenticated, setPrefs]);

    const reopen = useCallback(() => {
        setShow(true);
    }, []);

    /** After clearDemoGates / Show intro again — coach may show on next entry. */
    const reset = useCallback(() => {
        setShow(true);
        setReady(true);
    }, []);

    return { ready, show, dismiss, reopen, reset, product };
}

export function termById(id: string): GlossaryTerm | undefined {
    return GLOSSARY.find((t) => t.id === id);
}

/** Compact “?” control that opens a single-term tip or the full glossary. */
export function TermHint({
    termId,
    onOpenGlossary,
}: {
    termId: string;
    onOpenGlossary?: (focusId?: string) => void;
}) {
    const term = termById(termId);
    const [open, setOpen] = useState(false);
    if (!term) return null;

    return (
        <>
            <Pressable
                onPress={() => {
                    if (onOpenGlossary) onOpenGlossary(termId);
                    else setOpen(true);
                }}
                // 18px mark + 13px slop per side = 44px touch target.
                hitSlop={13}
                accessibilityRole="button"
                accessibilityLabel={`What is ${term.label}?`}
                style={styles.hintBtn}
            >
                <Text style={styles.hintMark}>?</Text>
            </Pressable>
            <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
                <Pressable style={styles.tipBackdrop} onPress={() => setOpen(false)}>
                    <View style={styles.tipCard}>
                        <Text style={styles.tipTitle}>{term.label}</Text>
                        <Text style={styles.tipBody}>{term.body}</Text>
                        <Pressable onPress={() => setOpen(false)} style={styles.tipClose}>
                            <Text style={styles.tipCloseText}>Got it</Text>
                        </Pressable>
                    </View>
                </Pressable>
            </Modal>
        </>
    );
}

export function LabelWithHint({
    children,
    termId,
    onOpenGlossary,
    style,
}: {
    children: ReactNode;
    termId: string;
    onOpenGlossary?: (focusId?: string) => void;
    style?: object;
}) {
    return (
        <View style={[styles.labelRow, style]}>
            {typeof children === "string" ? <Text style={styles.labelText}>{children}</Text> : children}
            <TermHint termId={termId} onOpenGlossary={onOpenGlossary} />
        </View>
    );
}

export function HowItWorksCard({
    visible,
    onDismiss,
    onOpenGlossary,
}: {
    visible: boolean;
    onDismiss: () => void;
    onOpenGlossary?: () => void;
    /** Kept for API compatibility; card is now always one line until expanded. */
    compact?: boolean;
}) {
    const [open, setOpen] = useState(false);
    if (!visible) return null;

    return (
        <View style={styles.coach} accessibilityRole="summary">
            <View style={styles.coachHead}>
                <Text style={styles.coachEyebrow}>How this works</Text>
                <View style={styles.coachActions}>
                    <Pressable
                        onPress={() => setOpen((v) => !v)}
                        hitSlop={10}
                        accessibilityRole="button"
                    >
                        <Text style={styles.coachLink}>{open ? "Hide steps" : "See the 3 steps"}</Text>
                    </Pressable>
                    <Pressable onPress={onDismiss} hitSlop={10} accessibilityRole="button">
                        <Text style={styles.coachDismiss}>Dismiss</Text>
                    </Pressable>
                </View>
            </View>
            <Text style={styles.coachSummary}>
                Open a deal · Send a note to Jua · Check public proof
            </Text>
            {open ? (
                <>
                    <View style={styles.coachSteps}>
                        {HOW_IT_WORKS_STEPS.map((step) => (
                            <View key={step.n} style={styles.coachStep}>
                                <Text style={styles.coachN}>{step.n}</Text>
                                <View style={styles.coachCopy}>
                                    <Text style={styles.coachTitle}>{step.title}</Text>
                                    <Text style={styles.coachBody}>{step.body}</Text>
                                </View>
                            </View>
                        ))}
                    </View>
                    {onOpenGlossary ? (
                        <Pressable onPress={onOpenGlossary}>
                            <Text style={styles.coachLink}>Browse terms</Text>
                        </Pressable>
                    ) : null}
                </>
            ) : null}
        </View>
    );
}

/** One-line re-orientation on a new browser session (already onboarded). */
export function WelcomeBackBanner({
    visible,
    onDismiss,
    onHowItWorks,
    onGlossary,
}: {
    visible: boolean;
    onDismiss: () => void;
    onHowItWorks?: () => void;
    onGlossary?: () => void;
}) {
    if (!visible) return null;

    return (
        <View style={styles.welcome} accessibilityRole="summary">
            <Text style={styles.welcomeLead}>
                Welcome back — deals are where you act · the ledger is public proof.
            </Text>
            <View style={styles.welcomeActions}>
                {onHowItWorks ? (
                    <Pressable onPress={onHowItWorks} hitSlop={8}>
                        <Text style={styles.coachLink}>How it works</Text>
                    </Pressable>
                ) : null}
                {onGlossary ? (
                    <Pressable onPress={onGlossary} hitSlop={8}>
                        <Text style={styles.coachLink}>Terms</Text>
                    </Pressable>
                ) : null}
                <Pressable onPress={onDismiss} hitSlop={8} accessibilityRole="button">
                    <Text style={styles.coachDismiss}>Dismiss</Text>
                </Pressable>
            </View>
        </View>
    );
}

export function GlossaryModal({
    visible,
    onClose,
    focusId,
}: {
    visible: boolean;
    onClose: () => void;
    focusId?: string;
}) {
    const insets = useSafeAreaInsets();
    const { width, height } = useWindowDimensions();
    const wide = width >= 720;

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <View style={[styles.sheetRoot, { paddingTop: insets.top + 8 }]}>
                <Pressable style={styles.sheetDim} onPress={onClose} accessibilityLabel="Close glossary" />
                <View
                    style={[
                        styles.sheet,
                        {
                            maxHeight: height * 0.86,
                            maxWidth: wide ? layout.maxWidth : undefined,
                            paddingBottom: Math.max(insets.bottom, 16),
                        },
                    ]}
                >
                    <View style={styles.sheetHandle} />
                    <View style={styles.sheetHead}>
                        <Text style={styles.sheetTitle}>Terms</Text>
                        <Pressable onPress={onClose} hitSlop={10}>
                            <Text style={styles.coachDismiss}>Close</Text>
                        </Pressable>
                    </View>
                    <Text style={styles.sheetSub}>Short definitions for this demo — tap a term anytime via ?</Text>
                    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetList}>
                        {GLOSSARY.map((term) => {
                            const focused = focusId === term.id;
                            return (
                                <View key={term.id} style={[styles.termCard, focused && styles.termCardOn]}>
                                    <Text style={styles.termLabel}>{term.label}</Text>
                                    <Text style={styles.termShort}>{term.short}</Text>
                                    <Text style={styles.termBody}>{term.body}</Text>
                                </View>
                            );
                        })}
                    </ScrollView>
                </View>
            </View>
        </Modal>
    );
}

export function HelpMenuButton({
    onHowItWorks,
    onGlossary,
    onShowIntro,
    footer,
}: {
    onHowItWorks: () => void;
    onGlossary: () => void;
    /** Optional — returns to landing pitch (demo recovery). */
    onShowIntro?: () => void;
    /** Optional muted row at the menu's foot — e.g. the fidelity badge on mobile. */
    footer?: ReactNode;
}) {
    const [open, setOpen] = useState(false);

    return (
        <>
            <Pressable
                onPress={() => setOpen((v) => !v)}
                style={styles.helpBtn}
                accessibilityRole="button"
                accessibilityLabel="Help"
            >
                <Text style={styles.helpBtnText}>Help</Text>
            </Pressable>
            {open ? (
                <View style={styles.helpMenu}>
                    <Pressable
                        onPress={() => {
                            setOpen(false);
                            onHowItWorks();
                        }}
                        style={styles.helpItem}
                    >
                        <Text style={styles.helpItemText}>How this works</Text>
                    </Pressable>
                    <Pressable
                        onPress={() => {
                            setOpen(false);
                            onGlossary();
                        }}
                        style={styles.helpItem}
                    >
                        <Text style={styles.helpItemText}>Terms</Text>
                    </Pressable>
                    {onShowIntro ? (
                        <Pressable
                            onPress={() => {
                                setOpen(false);
                                onShowIntro();
                            }}
                            style={styles.helpItem}
                        >
                            <Text style={styles.helpItemText}>Show intro again</Text>
                        </Pressable>
                    ) : null}
                    {footer ? <View style={styles.helpFooter}>{footer}</View> : null}
                </View>
            ) : null}
        </>
    );
}

const styles = StyleSheet.create({
    hintBtn: {
        width: 18,
        height: 18,
        borderRadius: 9,
        borderWidth: 1,
        borderColor: color.lineStrong,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: color.paper,
    },
    hintMark: {
        fontFamily: font.bodyBold,
        fontSize: 10,
        fontWeight: "700",
        color: color.mist,
        lineHeight: 12,
    },
    labelRow: { flexDirection: "row", alignItems: "center", gap: 4 },
    labelText: {
        fontFamily: font.bodyBold,
        fontSize: 9,
        fontWeight: "700",
        color: color.mist,
        textTransform: "uppercase",
        letterSpacing: 0.5,
    },
    tipBackdrop: {
        flex: 1,
        backgroundColor: "rgba(20,24,22,0.45)",
        justifyContent: "center",
        padding: 24,
    },
    tipCard: {
        backgroundColor: color.paper,
        borderRadius: 8,
        padding: 18,
        gap: 10,
        borderWidth: 1,
        borderColor: color.line,
        maxWidth: 400,
        alignSelf: "center",
        width: "100%",
    },
    tipTitle: {
        fontFamily: font.displayMedium,
        fontSize: 18,
        fontWeight: "600",
        color: color.charcoal,
    },
    tipBody: { fontFamily: font.body, fontSize: 14, lineHeight: 20, color: color.ink },
    tipClose: {
        alignSelf: "flex-start",
        marginTop: 4,
        backgroundColor: color.charcoal,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 4,
    },
    tipCloseText: { fontFamily: font.bodyBold, color: color.paper, fontWeight: "700", fontSize: 13 },
    coach: {
        gap: 12,
        padding: 14,
        backgroundColor: color.paper,
        borderWidth: 1,
        borderColor: color.brass,
        borderRadius: 6,
    },
    coachHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    coachActions: { flexDirection: "row", alignItems: "center", gap: 14 },
    coachSummary: {
        fontFamily: font.bodyMedium,
        fontSize: 13,
        color: color.ink,
        marginTop: 2,
    },
    coachEyebrow: {
        fontFamily: font.bodyBold,
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 1.2,
        textTransform: "uppercase",
        color: color.brassDeep,
    },
    coachDismiss: { fontFamily: font.bodyBold, fontSize: 12, fontWeight: "700", color: color.mist },
    coachSteps: { gap: 10 },
    coachStep: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
    coachN: {
        fontFamily: font.display,
        fontSize: 16,
        fontWeight: "700",
        color: color.brassDeep,
        width: 18,
    },
    coachCopy: { flex: 1, gap: 2 },
    coachTitle: { fontFamily: font.bodyBold, fontSize: 13, fontWeight: "700", color: color.charcoal },
    coachBody: { fontFamily: font.body, fontSize: 12, lineHeight: 17, color: color.mist },
    coachLink: {
        fontFamily: font.bodyBold,
        fontSize: 12,
        fontWeight: "700",
        color: color.brassDeep,
        paddingTop: 2,
    },
    welcome: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        marginHorizontal: 14,
        marginBottom: 6,
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: color.paper,
        borderWidth: 1,
        borderColor: color.line,
        borderRadius: 6,
        maxWidth: layout.maxWidth,
        alignSelf: "stretch",
    },
    welcomeLead: {
        flex: 1,
        fontFamily: font.bodyMedium,
        fontSize: 12,
        lineHeight: 16,
        color: color.ink,
    },
    welcomeActions: { flexDirection: "row", alignItems: "center", gap: 12 },
    sheetRoot: { flex: 1, justifyContent: "flex-end", alignItems: "center" },
    sheetDim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(20,24,22,0.4)" },
    sheet: {
        width: "100%",
        backgroundColor: color.paper,
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
        paddingHorizontal: 16,
        paddingTop: 8,
        borderWidth: 1,
        borderColor: color.line,
        gap: 8,
    },
    sheetHandle: {
        alignSelf: "center",
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: color.lineStrong,
        marginBottom: 4,
    },
    sheetHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    sheetTitle: {
        fontFamily: font.displayMedium,
        fontSize: 22,
        fontWeight: "600",
        color: color.charcoal,
    },
    sheetSub: { fontFamily: font.body, fontSize: 12, color: color.mist, marginBottom: 4 },
    sheetList: { gap: 10, paddingBottom: 12 },
    termCard: {
        gap: 4,
        padding: 12,
        borderRadius: 6,
        backgroundColor: color.stone,
        borderWidth: 1,
        borderColor: color.line,
    },
    termCardOn: { borderColor: color.brass, backgroundColor: color.brassSoft },
    termLabel: { fontFamily: font.bodyBold, fontSize: 14, fontWeight: "700", color: color.charcoal },
    termShort: { fontFamily: font.bodyMedium, fontSize: 12, color: color.brass },
    termBody: { fontFamily: font.body, fontSize: 13, lineHeight: 18, color: color.ink },
    helpBtn: {
        borderWidth: 1,
        borderColor: color.lineStrong,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 4,
        backgroundColor: color.paper,
        minHeight: 36,
        justifyContent: "center",
    },
    helpBtnText: { fontFamily: font.bodyBold, fontSize: 12, fontWeight: "700", color: color.charcoal },
    helpMenu: {
        position: "absolute",
        top: 40,
        right: 0,
        zIndex: 20,
        minWidth: 160,
        backgroundColor: color.paper,
        borderWidth: 1,
        borderColor: color.lineStrong,
        borderRadius: 6,
        overflow: "hidden",
        ...Platform.select({
            web: { boxShadow: "0 8px 24px rgba(20,24,22,0.12)" } as object,
            default: {
                shadowColor: color.charcoal,
                shadowOpacity: 0.12,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 6 },
                elevation: 4,
            },
        }),
    },
    helpItem: { paddingHorizontal: 14, paddingVertical: 12 },
    helpItemText: { fontFamily: font.bodyBold, fontSize: 13, fontWeight: "700", color: color.charcoal },
    helpFooter: {
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderTopWidth: 1,
        borderTopColor: color.line,
        marginTop: 2,
    },
});
