import { useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";

import { InvestorCockpit } from "@/components/jua-kali/investor-cockpit";
import { useRequireAuthToAct } from "@/components/jua-kali/soft-identity";
import type { Id } from "@/convex/_generated/dataModel";
import { color } from "@/components/jua-kali/theme";

export default function DealDetailScreen() {
    const { dealId } = useLocalSearchParams<{ dealId: string }>();
    const router = useRouter();
    const requireAuthToAct = useRequireAuthToAct();

    return (
        <View style={{ flex: 1, backgroundColor: color.stone }}>
            <InvestorCockpit
                initialCommitmentId={dealId as Id<"commitments">}
                onOpenLedger={() => router.push("/(tabs)/proof")}
                requireAuthToAct={requireAuthToAct}
                dealsOnly
                focusSingleDeal
            />
        </View>
    );
}
