import { useLocalSearchParams, useRouter } from "expo-router";

import { InvestorCockpit } from "@/components/jua-kali/investor-cockpit";
import { useRequireAuthToAct } from "@/components/jua-kali/soft-identity";
import { Atmosphere } from "@/components/jua-kali/ui";
import type { Id } from "@/convex/_generated/dataModel";

export default function DealsScreen() {
    const params = useLocalSearchParams<{ c?: string; v?: string }>();
    const router = useRouter();
    const requireAuthToAct = useRequireAuthToAct();

    return (
        <Atmosphere variant="app">
            <InvestorCockpit
                initialCommitmentId={params.c as Id<"commitments"> | undefined}
                initialVentureSlug={params.v}
                onOpenLedger={() => router.push("/(tabs)/proof")}
                onOpenDeal={(dealId) => router.push(`/deals/${dealId}`)}
                requireAuthToAct={requireAuthToAct}
                dealsOnly
            />
        </Atmosphere>
    );
}
