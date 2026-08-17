import { useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";

import { PublicLedger } from "@/components/jua-kali/public-ledger";
import { color } from "@/components/jua-kali/theme";

export default function ProofScreen() {
    const params = useLocalSearchParams<{ ledger?: string }>();
    const router = useRouter();

    return (
        <View style={{ flex: 1, backgroundColor: color.stone }}>
            <PublicLedger
                initialVentureSlug={typeof params.ledger === "string" ? params.ledger : undefined}
                onOpenEvent={(eventId) => router.push(`/proof/${eventId}`)}
            />
        </View>
    );
}
