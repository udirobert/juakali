import { useEffect } from "react";
import { Platform } from "react-native";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { Stack } from "expo-router";
import Head from "expo-router/head";
import * as SecureStore from "expo-secure-store";
import {
    Fraunces_600SemiBold,
    Fraunces_700Bold,
    useFonts as useFraunces,
} from "@expo-google-fonts/fraunces";
import {
    IBMPlexSans_400Regular,
    IBMPlexSans_500Medium,
    IBMPlexSans_700Bold,
    useFonts as usePlex,
} from "@expo-google-fonts/ibm-plex-sans";

import { color } from "@/components/jua-kali/theme";
import { InvestorSessionProvider } from "@/components/jua-kali/investor-session";
import { SITE, absoluteUrl } from "@/lib/site";

const convex = new ConvexReactClient(process.env.EXPO_PUBLIC_CONVEX_URL!, {
    unsavedChangesWarning: false,
});

const secureStorage = {
    getItem: SecureStore.getItemAsync,
    setItem: SecureStore.setItemAsync,
    removeItem: SecureStore.deleteItemAsync,
};

const isNative = Platform.OS === "ios" || Platform.OS === "android";

export default function RootLayout() {
    const [frauncesLoaded] = useFraunces({
        Fraunces_600SemiBold,
        Fraunces_700Bold,
    });
    const [plexLoaded] = usePlex({
        IBMPlexSans_400Regular,
        IBMPlexSans_500Medium,
        IBMPlexSans_700Bold,
    });

    // Fonts load without blocking first paint — text starts on system
    // fallbacks and swaps to Fraunces/Plex when ready. No boot spinner.
    useEffect(() => {
        if (Platform.OS !== "web" || typeof document === "undefined") return;
        const id = "juakali-fonts";
        if (document.getElementById(id)) return;
        const link = document.createElement("link");
        link.id = id;
        link.rel = "stylesheet";
        link.href =
            "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=IBM+Plex+Sans:wght@400;500;700&display=swap";
        document.head.appendChild(link);

        // Crisper text on macOS + a visible brass focus ring for keyboard users.
        // Applied once at the root, not per element.
        const baseId = "juakali-web-base";
        if (!document.getElementById(baseId)) {
            const style = document.createElement("style");
            style.id = baseId;
            style.textContent =
                "html { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; } " +
                ":focus-visible { outline: 2px solid #A67C2D; outline-offset: 2px; border-radius: 2px; }";
            document.head.appendChild(style);
        }
    }, []);

    void frauncesLoaded;
    void plexLoaded;

    const ogImage = absoluteUrl(SITE.ogImagePath);

    return (
        <ConvexAuthProvider client={convex} storage={isNative ? secureStorage : undefined}>
            <Head>
                <title>{SITE.title}</title>
                <meta name="description" content={SITE.description} />
                <meta property="og:title" content={SITE.title} />
                <meta property="og:description" content={SITE.description} />
                <meta property="og:image" content={ogImage} />
                <meta name="twitter:card" content="summary_large_image" />
                <meta name="twitter:title" content={SITE.title} />
                <meta name="twitter:description" content={SITE.description} />
                <meta name="twitter:image" content={ogImage} />
            </Head>
            {/* Session lives above the root Stack so tabs AND root detail routes
                (deals/[dealId], runs/[runId], approvals/[proposalId]) share the
                same selected deal, drafts, and active-run state. */}
            <InvestorSessionProvider>
                <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.stone } }} />
            </InvestorSessionProvider>
        </ConvexAuthProvider>
    );
}
