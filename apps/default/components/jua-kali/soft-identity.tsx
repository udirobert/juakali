import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import { useOAuthSignIn } from "@/hooks/use-oauth-sign-in";
import { useProductMode } from "@/lib/product-mode";
import { color, font, motion } from "@/components/jua-kali/theme";
import { tapHaptic } from "@/components/jua-kali/haptics";

/**
 * One app-level capability check: does this build require sign-in before
 * acting (pledge / approve / retry / autonomy)? Every mutation entry point
 * should gate on this so the UI gives consistent pre-action messaging instead
 * of failing only after the user presses a button.
 */
export function useRequireAuthToAct(): boolean {
    const softAuth = useQuery(api.softAuth.softAuthConfig);
    const product = useProductMode();
    return Boolean(softAuth?.requireAuthToAct) || product.requireAuthToAct;
}

function firstName(name: string | null | undefined, email: string | null | undefined) {
    const fromName = name?.trim().split(/\s+/)[0];
    if (fromName) return fromName;
    const fromEmail = email?.trim().split("@")[0];
    return fromEmail || null;
}

export function SoftIdentityBar({
    compact,
    forceOpen,
    onClose,
    heading,
    initialEmail,
}: {
    compact?: boolean;
    forceOpen?: boolean;
    onClose?: () => void;
    /** Optional framing for inline capture flows (e.g. after opening a commitment). */
    heading?: string;
    /** Prefill the email field (e.g. captured during onboarding). */
    initialEmail?: string;
}) {
    const { isAuthenticated, isLoading } = useConvexAuth();
    const { signIn, signOut } = useAuthActions();
    const { signInWith, isLoading: oauthLoading } = useOAuthSignIn();
    const me = useQuery(api.softAuth.whoAmI);
    const config = useQuery(api.softAuth.softAuthConfig);
    const product = useProductMode();
    const ensureInvestor = useMutation(api.softAuth.ensureMyInvestor);

    const [email, setEmail] = useState(initialEmail ?? "");
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

    const googleSignIn = useCallback(async () => {
        setError(null);
        try {
            await signInWith("google");
        } catch (e) {
            setError(e instanceof Error ? e.message : "Google sign-in unavailable.");
        }
    }, [signInWith]);

    const openPeek = useCallback(async () => {
        if (!peek || !("url" in peek) || !peek.url) return;
        if (Platform.OS === "web" && typeof window !== "undefined") {
            window.location.href = peek.url;
            return;
        }
        await Linking.openURL(peek.url);
    }, [peek]);

    if (isLoading) return null;

    if (isAuthenticated) {
        const name = firstName(me?.name, me?.email);
        return (
            <View style={[styles.bar, compact && styles.barCompact]}>
                <View style={styles.presenceDot} />
                <Text style={styles.signed} numberOfLines={1}>
                    {name ? `${name} · signed in` : me?.email ?? "Signed in"}
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
                <Text style={styles.title}>{heading ?? "Sign in"}</Text>
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
                Email magic link — your deals stay with you across sessions.{" "}
                {config?.resendConfigured
                    ? "Check your inbox after sending."
                    : config?.inboxPeek
                      ? "Demo inbox: the link appears here after send."
                      : product.preset === "demo"
                        ? "Demo build: configure a mail provider to receive links."
                        : ""}
            </Text>
            {Platform.OS === "web" ? (
                <Pressable
                    onPress={() => void googleSignIn()}
                    onPressIn={tapHaptic}
                    disabled={oauthLoading}
                    style={({ pressed }) => [
                        styles.googleBtn,
                        pressed && styles.btnPressed,
                        oauthLoading && styles.disabled,
                    ]}
                    accessibilityRole="button"
                >
                    <Text style={styles.googleText}>
                        {oauthLoading ? "Opening…" : "Continue with Google"}
                    </Text>
                </Pressable>
            ) : null}
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
                onPressIn={tapHaptic}
                disabled={busy}
                style={({ pressed }) => [
                    styles.primary,
                    pressed && styles.btnPressed,
                    busy && styles.disabled,
                ]}
                accessibilityRole="button"
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
    initialEmail,
}: {
    required: boolean;
    children: ReactNode;
    message?: string;
    initialEmail?: string;
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
                    "This build asks you to sign in before pledging or approving agent notes — so your deals stay with you."}
            </Text>
            <SoftIdentityBar forceOpen initialEmail={initialEmail} />
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
    presenceDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: color.success },
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
        color: color.brassDeep,
    },
    hint: { fontFamily: font.body, fontSize: 12, lineHeight: 17, color: color.mist },
    googleBtn: {
        borderWidth: 1,
        borderColor: color.lineStrong,
        borderRadius: 4,
        paddingVertical: 11,
        alignItems: "center",
        backgroundColor: color.stone,
    },
    googleText: { fontFamily: font.bodyBold, fontSize: 13, fontWeight: "700", color: color.charcoal },
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
    btnPressed: { transform: [{ scale: motion.pressScale }] },
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
