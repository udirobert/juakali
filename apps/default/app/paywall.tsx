import { Paywall } from "@/components/jua-kali/paywall";

/**
 * Shipaton 2026 paywall route (`/paywall`).
 * Render as its own expo-router screen; deep link `juakali://paywall`.
 */
export default function PaywallRoute() {
    return <Paywall />;
}