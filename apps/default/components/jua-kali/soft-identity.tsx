import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import { color, font } from "@/components/jua-kali/theme";

export function SoftIdentityBar({
    compact,
    forceOpen,
    onClose,
}: {
    compact?: boolean;
    forceOpen?: boolean;
    onClose?: () => void;
}) {
    const { isAuthenticated, isLoading } = useConvexAuth();
    const { signIn, signOut } = useAuthActions();
    const me = useQuery(api.softAuth.whoAmI);
    const config = useQuery(api.softAuth.softAuthConfig);
    const ensureInvestor = useMutation(api.softAuth.ensureMyInvestor);

    const [email, setEmail] = useState("");
    const [busy, setBusy] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [expanded, setExpanded] = useState(Boolean(forceOpen));

    const peekEmail = sent ? email.trim().toLowerCase() : "";
    const peek = useQuery(
        api.softAuth.peekSoftAuthLink,
        config?.inboxPeek && peekEmail.includes("@") ? { email: peekEmail } : "skip"
    );

    useEffect(() => {
        if (forceOpen) setExpanded(true);
    }, [forceOpen]);

    useEffect(() => {
        if (!isAuthenticated) return;
        void ensureInvestor({}).catch(() => {
            // non-blocking
        });
    }, [isAuthenticated, ensureInvestor]);

    const sendLink = useCallback(async () => {
        setError(null);
        const value = email.trim().toLowerCase();
        if (!value.includes("@")) {
            setError("Enter a valid email.");
            return;
        }
        setBusy(true);
        try {
            const form = new FormData();
            form.set("email", value);
            await signIn("soft-email", form);
            setSent(true);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not send sign-in link.");
        } finally {
            setBusy(false);
        }
    }, [email, signIn]);

    const openPeek = useCallback(async () => {
        if (!peek || !("url" in peek)) return;
        if (Platform.OS === "web" && typeof window !== "undefined") {
            window.location.href = peek.url;
            return;
        }
        await Linking.openURL(peek.url);
    }, [peek]);

    if (isLoading) return null;

    if (isAuthenticated) {
        return (
            <View style={[styles.bar, compact && styles.barCompact]}>
                <Text style={styles.signed} numberOfLines={1}>
                    {me?.email ?? me?.name ?? "Signed in"}
                </Text>
                <Pressable
                    onPress={() => void signOut()}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Sign out"
                >
                    <Text style={styles.link}>Sign out</Text>
                </Pressable>
            </View>
        );
    }

    if (!expanded) {
        return (
            <Pressable
                onPress={() => setExpanded(true)}
                style={[styles.bar, compact && styles.barCompact]}
                accessibilityRole="button"
            >
                <Text style={styles.cta}>Sign in with email</Text>
            </Pressable>
        );
    }

    return (
        <View style={styles.panel}>
            <View style={styles.panelHead}>
                <Text style={styles.title}>Soft identity</Text>
                {onClose || !forceOpen ? (
                    <Pressable
                        onPress={() => {
                            setExpanded(false);
                            onClose?.();
                        }}
                        hitSlop={8}
                    >
                        <Text style={styles.link}>Close</Text>
                    </Pressable>
                ) : null}
            </View>
            <Text style={styles.hint}>
                Email magic link — keeps your deals with you.{" "}
                {config?.resendConfigured
                    ? "Check your inbox after sending."
                    : config?.inboxPeek
                      ? "Demo inbox: the link appears here after send."
                      : "Configure AUTH_RESEND_KEY or SOFT_AUTH_INBOX=1 on Convex."}
            </Text>
            <TextInput
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="you@example.com"
                placeholderTextColor={color.mist}
                style={styles.input}
                editable={!busy}
            />
            <Pressable
                onPress={() => void sendLink()}
                disabled={busy}
                style={[styles.primary, busy && styles.disabled]}
            >
                <Text style={styles.primaryText}>{busy ? "Sending…" : sent ? "Send again" : "Send magic link"}</Text>
            </Pressable>
            {sent ? <Text style={styles.status}>Link requested for {email.trim().toLowerCase()}.</Text> : null}
            {peek && "url" in peek ? (
                <Pressable onPress={() => void openPeek()} style={styles.secondary}>
                    <Text style={styles.secondaryText}>Open demo magic link</Text>
                </Pressable>
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
    );
}

/** Blocks act surfaces when server requires auth and user is anonymous. */
export function AuthRequiredGate({
    required,
    children,
    message,
}: {
    required: boolean;
    children: ReactNode;
    message?: string;
}) {
    const { isAuthenticated, isLoading } = useConvexAuth();
    if (!required || isLoading || isAuthenticated) {
        return <>{children}</>;
    }
    return (
        <View style={styles.gate}>
            <Text style={styles.gateTitle}>Sign in to continue</Text>
            <Text style={styles.gateBody}>
                {message ??
                    "This build requires soft identity before pledging or approving agent notes."}
            </Text>
            <SoftIdentityBar forceOpen />
        </View>
    );
}

const styles = StyleSheet.create({
    bar: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: color.lineStrong,
        backgroundColor: color.paper,
    },
    barCompact: { paddingVertical: 6, paddingHorizontal: 8 },
    signed: { flex: 1, fontFamily: font.bodyMedium, fontSize: 12, color: color.ink },
    cta: { fontFamily: font.bodyBold, fontSize: 12, fontWeight: "700", color: color.charcoal },
    link: { fontFamily: font.bodyBold, fontSize: 12, fontWeight: "700", color: color.brass },
    panel: {
        gap: 8,
        padding: 12,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: color.brass,
        backgroundColor: color.paper,
    },
    panelHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    title: {
        fontFamily: font.bodyBold,
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 0.8,
        textTransform: "uppercase",
        color: color.brass,
    },
    hint: { fontFamily: font.body, fontSize: 12, lineHeight: 17, color: color.mist },
    input: {
        borderWidth: 1,
        borderColor: color.lineStrong,
        borderRadius: 4,
        paddingHorizontal: 12,
        paddingVertical: 10,
        color: color.ink,
        backgroundColor: color.stone,
        fontFamily: font.body,
        fontSize: 15,
    },
    primary: {
        backgroundColor: color.charcoal,
        paddingVertical: 12,
        borderRadius: 4,
        alignItems: "center",
    },
    primaryText: { fontFamily: font.bodyBold, color: color.paper, fontWeight: "700", fontSize: 13 },
    secondary: { paddingVertical: 10, alignItems: "center" },
    secondaryText: { fontFamily: font.bodyBold, fontSize: 13, fontWeight: "700", color: color.brass },
    status: { fontFamily: font.body, fontSize: 12, color: color.mist },
    error: { fontFamily: font.body, fontSize: 12, color: color.danger },
    disabled: { opacity: 0.5 },
    gate: { gap: 10, padding: 14 },
    gateTitle: {
        fontFamily: font.displayMedium,
        fontSize: 18,
        fontWeight: "600",
        color: color.charcoal,
    },
    gateBody: { fontFamily: font.body, fontSize: 13, lineHeight: 18, color: color.mist },
});
