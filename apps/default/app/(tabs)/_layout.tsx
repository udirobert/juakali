import { Platform } from "react-native";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { OnboardingGate } from "@/components/jua-kali/onboarding-gate";
import { color, font } from "@/components/jua-kali/theme";

export default function TabsLayout() {
    const insets = useSafeAreaInsets();
    const useTopNav = Platform.OS === "web";

    return (
        <OnboardingGate>
            <Tabs
                    screenOptions={{
                        headerShown: false,
                        tabBarActiveTintColor: color.charcoal,
                        tabBarInactiveTintColor: color.mist,
                        tabBarLabelStyle: {
                            fontFamily: font.bodyBold,
                            fontSize: 11,
                            letterSpacing: 0.2,
                        },
                        tabBarStyle: useTopNav
                            ? {
                                  backgroundColor: color.paper,
                                  borderTopColor: color.line,
                                  height: 56,
                              }
                            : {
                                  backgroundColor: color.paper,
                                  borderTopColor: color.line,
                                  paddingBottom: Math.max(insets.bottom, 8),
                                  height: 56 + Math.max(insets.bottom, 8),
                              },
                    }}
                >
                    <Tabs.Screen
                        name="today"
                        options={{
                            title: "Today",
                            tabBarIcon: ({ color: tint, size }) => (
                                <Ionicons name="sunny-outline" size={size} color={tint} />
                            ),
                            tabBarAccessibilityLabel: "Today briefing",
                        }}
                    />
                    <Tabs.Screen
                        name="deals"
                        options={{
                            title: "Deals",
                            tabBarIcon: ({ color: tint, size }) => (
                                <Ionicons name="briefcase-outline" size={size} color={tint} />
                            ),
                            tabBarAccessibilityLabel: "Deals portfolio",
                        }}
                    />
                    <Tabs.Screen
                        name="proof"
                        options={{
                            title: "Proof",
                            tabBarIcon: ({ color: tint, size }) => (
                                <Ionicons name="shield-checkmark-outline" size={size} color={tint} />
                            ),
                            tabBarAccessibilityLabel: "Public proof ledger",
                        }}
                    />
                </Tabs>
        </OnboardingGate>
    );
}
