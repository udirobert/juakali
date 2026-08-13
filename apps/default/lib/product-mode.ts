import { Platform } from "react-native";
import { useConvexAuth } from "convex/react";
import { useMemo } from "react";

/** Who is acting — what may persist across devices. */
export type IdentityMode = "anonymous" | "soft" | "authenticated";

/** Instrument reality — must stay honest in UI. */
export type FidelityMode = "mock" | "soft" | "live";

/** How aggressively we re-orient. */
export type TeachingPolicy = "loud" | "soft-return" | "quiet";

/** Deploy / intent bundle — not a forked app. */
export type ProductPreset = "demo" | "app";

export type ProductMode = {
    preset: ProductPreset;
    identity: IdentityMode;
    fidelity: FidelityMode;
    teaching: TeachingPolicy;
    /** Session welcome-back on cold browser return. */
    sessionWelcomeBack: boolean;
    /** Coach dismiss stored only for this session (web) / short TTL (native). */
    coachSessionScoped: boolean;
    /** Soft-return: re-orient after long absence. */
    softReturnMs: number;
    /** Future: block pledge/approve until signed in. */
    requireAuthToAct: boolean;
    showFidelityBadge: boolean;
    fidelityBadge: string;
    fidelityHint: string;
};

export const SOFT_RETURN_MS = 14 * 24 * 60 * 60 * 1000;

function readEnvPreset(): ProductPreset {
    const raw = (process.env.EXPO_PUBLIC_PRODUCT_PRESET ?? "demo").toLowerCase();
    return raw === "app" ? "app" : "demo";
}

function readUrlDemoForce(): boolean {
    if (Platform.OS !== "web" || typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("demo") === "1";
}

function readRequireAuthFlag(): boolean {
    return (process.env.EXPO_PUBLIC_REQUIRE_AUTH_TO_ACT ?? "").toLowerCase() === "1";
}

/** Capital path is soft pledges until settlement exists. */
export const CURRENT_FIDELITY: FidelityMode = "soft";

export function resolveProductMode(input: {
    preset?: ProductPreset;
    isAuthenticated: boolean;
    forceDemo?: boolean;
    fidelity?: FidelityMode;
}): ProductMode {
    const forceDemo = input.forceDemo ?? false;
    const preset: ProductPreset = forceDemo ? "demo" : (input.preset ?? readEnvPreset());
    const fidelity = input.fidelity ?? CURRENT_FIDELITY;
    const identity: IdentityMode = input.isAuthenticated ? "authenticated" : "anonymous";

    let teaching: TeachingPolicy;
    if (preset === "demo" || forceDemo) {
        teaching = "loud";
    } else if (identity === "authenticated") {
        teaching = "quiet";
    } else {
        teaching = "soft-return";
    }

    const fidelityBadge =
        fidelity === "live" ? "Live" : fidelity === "mock" ? "Mock · seed data" : "Soft · not settling";

    const fidelityHint =
        fidelity === "live"
            ? "Live settlement / inbox connected."
            : fidelity === "mock"
              ? "Example data for walkthroughs — not your capital."
              : "Soft pledges (not escrow) · AgentMail inbox live for inbound notes · Gmail later.";

    return {
        preset,
        identity,
        fidelity,
        teaching,
        sessionWelcomeBack: teaching === "loud",
        coachSessionScoped: teaching === "loud",
        softReturnMs: SOFT_RETURN_MS,
        requireAuthToAct: preset === "app" && readRequireAuthFlag(),
        showFidelityBadge: fidelity !== "live",
        fidelityBadge,
        fidelityHint,
    };
}

export function useProductMode(): ProductMode {
    const { isAuthenticated } = useConvexAuth();
    return useMemo(
        () =>
            resolveProductMode({
                isAuthenticated,
                forceDemo: readUrlDemoForce(),
                preset: readEnvPreset(),
            }),
        [isAuthenticated]
    );
}
