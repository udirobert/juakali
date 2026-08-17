import { useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";

import { InvestorCockpit } from "@/components/jua-kali/investor-cockpit";
import { useRequireAuthToAct } from "@/components/jua-kali/soft-identity";
import type { Id } from "@/convex/_generated/dataModel";
import { color } from "@/components/jua-kali/theme";

export default function DealsScreen() {
    const params = useLocalSearchParams<{ c?: string; v?: string }>();
    const router = useRouter();
    const requireAuthToAct = useRequireAuthToAct();

    return (
        <View style={{ flex: 1, backgroundColor: color.stone }}>
            <InvestorCockpit
                initialCommitmentId={params.c as Id<"commitments"> | undefined}
                initialVentureSlug={params.v}
                onOpenLedger={() => router.push("/(tabs)/proof")}
                onOpenDeal={(dealId) => router.push(`/deals/${dealId}`)}
                requireAuthToAct={requireAuthToAct}
                dealsOnly
            />
        </View>
    );
}
