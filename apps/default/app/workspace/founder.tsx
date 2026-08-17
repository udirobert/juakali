import { View } from "react-native";
import { useRouter } from "expo-router";

import { VentureCockpit } from "@/components/jua-kali/venture-cockpit";
import { OnboardingGate } from "@/components/jua-kali/onboarding-gate";
import { color } from "@/components/jua-kali/theme";

export default function FounderWorkspace() {
    const router = useRouter();
    return (
        <OnboardingGate>
            <View style={{ flex: 1, backgroundColor: color.stone }}>
                <VentureCockpit onOpenLedger={() => router.push("/(tabs)/proof")} />
            </View>
        </OnboardingGate>
    );
}
