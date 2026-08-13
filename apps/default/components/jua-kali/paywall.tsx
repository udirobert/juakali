import { useCallback, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { color, font, layout, type } from "@/components/jua-kali/theme";
import {
    configurePurchases,
    purchaseMonthly,
    restorePurchases,
    useEntitlements,
} from "@/components/jua-kali/subscription";
import { useProductMode } from "@/lib/product-mode";

type Tier = {
    id: string;
    name: string;
    price: string;
    blurb: string;
    features: string[];
    highlighted?: boolean;
};

const TIERS: Tier[] = [
    {
        id: "observer",
        name: "Observer",
        price: "Free",
        blurb: "Follow the Nairobi ledger from the outside.",
        features: ["Browse ventures", "Public ledger", "Follow 1 venture", "View digests"],
    },
    {
        id: "investor",
        name: "Investor",
        price: "$9.99/mo",
        blurb: "Soft-pledge into apprentice ventures.",
        features: [
            "Unlimited soft pledges",
            "Weekly agent digests + email",
            "KPI alerts",
            "Priority mentorship",
            "Multi-venture dashboard",
        ],
        highlighted: true,
    },
    {
        id: "mentor",
        name: "Mentor / Pro",
        price: "$24.99/mo",
        blurb: "For funds and active capital allocators.",
        features: [
            "Everything in Investor",
            "Advanced analytics (LTV / cohort)",
            "Custom KPI targets",
            "Export + MCP / API access",
            "White-glove onboarding",
        ],
    },
];

const isNative = Platform.OS === "ios" || Platform.OS === "android";

export function Paywall() {
    const insets = useSafeAreaInsets();
    const { fidelity, preset } = useProductMode();
    const entitlements = useEntitlements();
    const [busy, setBusy] = useState<"subscribe" | "restore" | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const live = fidelity === "live";
    const alreadyInvestor = entitlements.has("investor") || entitlements.has("pro");

    const onSubscribe = useCallback(async () => {
        if (!isNative) {
            setNotice("Subscriptions are available on the mobile app.");
            return;
        }
        setBusy("subscribe");
        setNotice(null);
        await configurePurchases();
        const res = await purchaseMonthly();
        setNotice(res.purchased ? "Subscription active — thank you." : (res.message ?? "Could not subscribe."));
        setBusy(null);
    }, []);

    const onRestore = useCallback(async () => {
        setBusy("restore");
        setNotice(null);
        const res = await restorePurchases();
        setNotice(res.purchased ? "Purchases restored." : (res.message ?? "Nothing to restore."));
        setBusy(null);
    }, []);

    return (
        <ScrollView
            style={[styles.screen, { paddingTop: insets.top + 16 }]}
            contentContainerStyle={styles.content}
        >
            <Text style={type.eyebrow}>{preset === "demo" ? "Demo · soft pledges" : "Live subscriptions"}</Text>
            <Text style={[type.brand, styles.headline]}>Invest in public.</Text>
            <Text style={type.body}>
                Support Kenya&apos;s informal-sector ventures with soft, transparent revenue-share
                commitments — mentored by an AI agent, visible on a public ledger.
            </Text>

            {!live && (
                <View style={styles.demoNote}>
                    <Text style={styles.demoText}>
                        {isNative
                            ? "Store billing is wired but the product is still soft/demo — the paid flow activates in live mode."
                            : "Subscriptions require the mobile app (iOS / Android)."}
                    </Text>
                </View>
            )}

            <View style={styles.cards}>
                {TIERS.map((tier) => {
                    const isOwned =
                        tier.id === "observer" ||
                        (tier.id === "investor" && alreadyInvestor) ||
                        (tier.id === "mentor" && entitlements.has("pro"));
                    return (
                        <View
                            key={tier.id}
                            style={[styles.card, tier.highlighted && styles.cardHighlight]}
                        >
                            <View style={styles.cardHead}>
                                <Text style={[type.title, styles.cardTitle]}>{tier.name}</Text>
                                <Text style={styles.cardPrice}>{tier.price}</Text>
                            </View>
                            <Text style={type.meta}>{tier.blurb}</Text>
                            {tier.features.map((f) => (
                                <View key={f} style={styles.featureRow}>
                                    <Text style={styles.bullet}>·</Text>
                                    <Text style={styles.feature}>{f}</Text>
                                </View>
                            ))}
                            {tier.highlighted && (
                                <Pressable
                                    onPress={onSubscribe}
                                    disabled={busy !== null || !live || isOwned}
                                    style={[styles.cta, (!live || isOwned) && styles.ctaDisabled]}
                                >
                                    {busy === "subscribe" ? (
                                        <ActivityIndicator color={color.paper} />
                                    ) : (
                                        <Text style={styles.ctaText}>
                                            {isOwned ? "Active" : live ? "Start Investor" : "Coming in live mode"}
                                        </Text>
                                    )}
                                </Pressable>
                            )}
                        </View>
                    );
                })}
            </View>

            <View style={styles.footer}>
                <Pressable onPress={onRestore} disabled={busy !== null} style={styles.linkBtn}>
                    {busy === "restore" ? (
                        <ActivityIndicator color={color.brass} />
                    ) : (
                        <Text style={styles.link}>Restore Purchases</Text>
                    )}
                </Pressable>
                <Text style={type.meta}>Manage or cancel anytime in App Store / Play Store.</Text>
                {notice ? <Text style={styles.notice}>{notice}</Text> : null}
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.stone },
    content: {
        paddingHorizontal: 20,
        paddingBottom: 48,
        alignSelf: "center",
        width: "100%",
        maxWidth: layout.maxWidth,
    },
    headline: { marginTop: 4, marginBottom: 12 },
    demoNote: {
        backgroundColor: color.brassSoft,
        borderColor: color.brass,
        borderWidth: 1,
        borderRadius: 8,
        padding: 12,
        marginTop: 18,
    },
    demoText: { fontFamily: font.bodyMedium, fontSize: 13, color: color.charcoal, lineHeight: 20 },
    cards: { gap: 14, marginTop: 22 },
    card: {
        backgroundColor: color.paper,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: color.line,
        padding: 16,
    },
    cardHighlight: {
        borderColor: color.brass,
        borderWidth: 2,
        backgroundColor: color.paper,
    },
    cardHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
    cardTitle: { fontSize: 22 },
    cardPrice: { fontFamily: font.displayMedium, fontSize: 16, color: color.brass },
    featureRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: 8 },
    bullet: { color: color.brass, fontFamily: font.bodyBold },
    feature: { flex: 1, fontFamily: font.body, fontSize: 14, color: color.ink, lineHeight: 20 },
    cta: {
        marginTop: 16,
        backgroundColor: color.charcoal,
        borderRadius: 8,
        paddingVertical: 13,
        alignItems: "center",
    },
    ctaDisabled: { backgroundColor: color.mist },
    ctaText: { fontFamily: font.bodyBold, fontSize: 15, color: color.paper },
    footer: { gap: 10, marginTop: 26 },
    linkBtn: { alignItems: "center", paddingVertical: 4 },
    link: { fontFamily: font.bodyBold, color: color.brass, fontSize: 14 },
    notice: { fontFamily: font.body, fontSize: 13, color: color.ink, textAlign: "center" },
});
