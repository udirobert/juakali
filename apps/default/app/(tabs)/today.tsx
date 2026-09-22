import { useCallback, useState } from "react";

import { TodayBriefing } from "@/components/jua-kali/today-briefing";
import {
    GlossaryModal,
    WelcomeBackBanner,
    useCoachGate,
} from "@/components/jua-kali/help";
import { useInvestorOnboardingGate } from "@/components/jua-kali/investor-onboarding";
import { writeCoachDismissed } from "@/components/jua-kali/session-persist";
import { Atmosphere } from "@/components/jua-kali/ui";
import { useProductMode } from "@/lib/product-mode";

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
        <Atmosphere variant="app">
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
        </Atmosphere>
    );
}
