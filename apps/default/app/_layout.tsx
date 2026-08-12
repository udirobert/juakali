import { useEffect } from "react";
import { ActivityIndicator, Platform, View } from "react-native";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { Stack } from "expo-router";
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
    }, []);

    if (!frauncesLoaded || !plexLoaded) {
        return (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: color.stone }}>
                <ActivityIndicator color={color.brass} />
            </View>
        );
    }

    return (
        <ConvexAuthProvider client={convex} storage={isNative ? secureStorage : undefined}>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.stone } }} />
        </ConvexAuthProvider>
    );
}
