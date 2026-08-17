import { LegacyRedirect } from "@/components/jua-kali/onboarding-gate";

/** Root entry: map legacy query params, then land on Today. */
export default function Index() {
    return <LegacyRedirect />;
}
