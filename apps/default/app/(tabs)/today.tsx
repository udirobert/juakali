import { useCallback, useState } from "react";
import { View } from "react-native";

import { TodayBriefing } from "@/components/jua-kali/today-briefing";
import {
    GlossaryModal,
    WelcomeBackBanner,
    useCoachGate,
} from "@/components/jua-kali/help";
import { useInvestorOnboardingGate } from "@/components/jua-kali/investor-onboarding";
import { writeCoachDismissed } from "@/components/jua-kali/session-persist";
import { useProductMode } from "@/lib/product-mode";
import { color } from "@/components/jua-kali/theme";

export default function TodayScreen() {
    const onboarding = useInvestorOnboardingGate();
    const coach = useCoachGate();
    const product = useProductMode();
    const [forceCoach, setForceCoach] = useState(false);
    const [glossaryOpen, setGlossaryOpen] = useState(false);
    const [glossaryFocus, setGlossaryFocus] = useState<string | undefined>();

    const showCoach = (forceCoach || (coach.show && !onboarding.showWelcomeBack)) && coach.ready;

    const handleDismissWelcome = useCallback(async () => {
        await onboarding.dismissWelcomeBack();
        await writeCoachDismissed(product.coachSessionScoped);
        setForceCoach(false);
    }, [onboarding, product.coachSessionScoped]);

    return (
        <View style={{ flex: 1, backgroundColor: color.stone }}>
            <WelcomeBackBanner
                visible={onboarding.showWelcomeBack}
                onDismiss={() => void handleDismissWelcome()}
                onHowItWorks={() => {
                    void handleDismissWelcome().then(() => setForceCoach(true));
                }}
                onGlossary={() => {
                    void handleDismissWelcome().then(() => setGlossaryOpen(true));
                }}
            />
            <TodayBriefing
                showCoach={showCoach}
                onDismissCoach={() => {
                    setForceCoach(false);
                    void coach.dismiss();
                }}
                onOpenGlossary={(id) => {
                    setGlossaryFocus(id);
                    setGlossaryOpen(true);
                }}
            />
            <GlossaryModal
                visible={glossaryOpen}
                onClose={() => setGlossaryOpen(false)}
                focusId={glossaryFocus}
            />
        </View>
    );
}
