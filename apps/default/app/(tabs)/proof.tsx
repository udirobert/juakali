import { useLocalSearchParams, useRouter } from "expo-router";

import { PublicLedger } from "@/components/jua-kali/public-ledger";
import { Atmosphere } from "@/components/jua-kali/ui";

export default function ProofScreen() {
    const params = useLocalSearchParams<{ ledger?: string }>();
    const router = useRouter();

    return (
        <Atmosphere variant="app">
            <PublicLedger
                initialVentureSlug={typeof params.ledger === "string" ? params.ledger : undefined}
                onOpenEvent={(eventId) => router.push(`/proof/${eventId}`)}
            />
        </Atmosphere>
    );
}
