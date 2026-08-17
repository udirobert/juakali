import { NativeTabs } from "expo-router/unstable-native-tabs";

import { OnboardingGate } from "@/components/jua-kali/onboarding-gate";
import { color, font } from "@/components/jua-kali/theme";

export default function TabsLayout() {
    return (
        <OnboardingGate>
            <NativeTabs
                tintColor={color.charcoal}
                backgroundColor={color.paper}
                labelStyle={{
                    color: color.mist,
                    fontFamily: font.bodyBold,
                    fontSize: 11,
                    fontWeight: "700",
                }}
            >
                <NativeTabs.Trigger name="today" accessibilityLabel="Today briefing">
                    <NativeTabs.Trigger.Label>Today</NativeTabs.Trigger.Label>
                    <NativeTabs.Trigger.Icon sf="sun.max" md="sunny" />
                </NativeTabs.Trigger>
                <NativeTabs.Trigger name="deals" accessibilityLabel="Deals portfolio">
                    <NativeTabs.Trigger.Label>Deals</NativeTabs.Trigger.Label>
                    <NativeTabs.Trigger.Icon sf="briefcase" md="business_center" />
                </NativeTabs.Trigger>
                <NativeTabs.Trigger name="proof" accessibilityLabel="Public proof ledger">
                    <NativeTabs.Trigger.Label>Proof</NativeTabs.Trigger.Label>
                    <NativeTabs.Trigger.Icon sf="checkmark.shield" md="verified_user" />
                </NativeTabs.Trigger>
            </NativeTabs>
        </OnboardingGate>
    );
}
