import { Platform, type TextStyle } from "react-native";

/** Meeting-ready “Nairobi ledger” tokens — cool stone, charcoal, brass (not cream/terracotta). */
export const color = {
    stone: "#E6E4DF",
    paper: "#F7F6F2",
    /** Warm white for text sitting on brass/charcoal fills. */
    foam: "#FFFDF7",
    charcoal: "#141816",
    ink: "#1C2420",
    brass: "#A67C2D",
    brassLight: "#C4A15A",
    brassDeep: "#7C5E22",
    brassSoft: "rgba(166, 124, 45, 0.14)",
    /** Meta text — darkened to ~5.5:1 on paper for WCAG AA at small sizes. */
    mist: "#5E6660",
    line: "rgba(20, 24, 22, 0.1)",
    lineStrong: "rgba(20, 24, 22, 0.18)",
    success: "#2F5D3A",
    danger: "#8B3A2F",
};
export type ColorTokens = typeof color;

/**
 * Dark-groundwork: an additive inversion of the ledger palette so the shell
 * can follow `useColorScheme` later without re-deriving tokens inline. Shipped
 * quietly — not yet consumed by any style. Light ("Nairobi ledger") stays the
 * default demo rag until native theming lands.
 */
export const colorDark: ColorTokens = {
    stone: "#131613",
    paper: "#181C19",
    foam: "#0B0E0C",
    charcoal: "#ECE9E2",
    ink: "#DCD9D1",
    brass: "#C4A15A",
    brassLight: "#D9BD7A",
    brassDeep: "#C4A15A",
    brassSoft: "rgba(196, 161, 90, 0.18)",
    mist: "#A9B0AA",
    line: "rgba(236, 233, 226, 0.12)",
    lineStrong: "rgba(236, 233, 226, 0.22)",
    success: "#6FB57F",
    danger: "#D9836F",
};

/** Pick the ledger rag by OS color scheme. Additive today: light is the default shell. */
export function themeColors(scheme: "light" | "dark"): ColorTokens {
    return scheme === "dark" ? colorDark : color;
}

/**
 * Radius scale — the app core already lives on {2, 4, 6, 8}; these tokens make
 * it explicit. Nested surfaces should read concentrically (outer = inner + padding),
 * which this 2-step scale satisfies for 8–12px paddings.
 */
export const radius = {
    xs: 2,
    sm: 4,
    md: 6,
    lg: 8,
    pill: 99,
};

/**
 * Motion tokens. Restrained by design: UI stays under 300ms, ease-out only,
 * no bounce. Stagger is reserved for infrequent authored moments (the arrival
 * voice, a proposal appearing) — never for routine taps or row updates.
 */
export const motion = {
    /** Immediate feedback (press, chip toggle). */
    fast: 150,
    /** Routine state change (cards, gates). */
    base: 250,
    /** Deliberately authored entrance (the arrival voice). Rare only. */
    slow: 400,
    /** The two authored moments — landing sun rise, approval ignition. */
    hero: 600,
    /** Delay between items in an authored stagger. */
    stagger: 60,
    /** Tactile press scale — 0.96; never below 0.95. */
    pressScale: 0.96,
};

/**
 * The sun system — the brand's signature. A venture's sun rises as it proves
 * itself: dawn (pledged, unproven) → rising (KPIs landing) → high noon
 * (digests published, ledger proof). Colors stay inside the brass family.
 */
export const sun = {
    dawn: color.brassDeep,
    rising: color.brass,
    noon: color.brassLight,
    /** Horizon hairline the hero sun rises over. */
    horizon: color.lineStrong,
};

/** fontVariant for any number that updates live — prevents layout jitter. */
export const tabularNums: TextStyle["fontVariant"] = ["tabular-nums"];

export const font = {
    display: Platform.select({
        web: '"Fraunces", "Times New Roman", serif',
        default: "Fraunces_700Bold",
    }) as string,
    displayMedium: Platform.select({
        web: '"Fraunces", "Times New Roman", serif',
        default: "Fraunces_600SemiBold",
    }) as string,
    body: Platform.select({
        web: '"IBM Plex Sans", system-ui, sans-serif',
        default: "IBMPlexSans_400Regular",
    }) as string,
    bodyMedium: Platform.select({
        web: '"IBM Plex Sans", system-ui, sans-serif',
        default: "IBMPlexSans_500Medium",
    }) as string,
    bodyBold: Platform.select({
        web: '"IBM Plex Sans", system-ui, sans-serif',
        default: "IBMPlexSans_700Bold",
    }) as string,
};

export const layout = {
    maxWidth: 880,
};

/**
 * Elevation — reserved for artifact surfaces (digest, proposal) that must read
 * as "produced documents" rather than flat boxes. Routine cards stay flat with
 * their 1px line; this is the exception, not the default.
 */
export const elevation = {
    raised: Platform.select({
        web: {
            boxShadow: "0 1px 2px rgba(20,24,22,0.05), 0 6px 18px rgba(20,24,22,0.05)",
        },
        default: {
            shadowColor: "#141816",
            shadowOpacity: 0.07,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: 2 },
            elevation: 2,
        },
    }),
};

export const type = {
    brand: {
        fontFamily: font.display,
        fontSize: 42,
        fontWeight: "700" as TextStyle["fontWeight"],
        letterSpacing: -1.4,
        color: color.charcoal,
    },
    title: {
        fontFamily: font.displayMedium,
        fontSize: 28,
        fontWeight: "600" as TextStyle["fontWeight"],
        letterSpacing: -0.6,
        color: color.charcoal,
    },
    eyebrow: {
        fontFamily: font.bodyBold,
        fontSize: 11,
        fontWeight: "700" as TextStyle["fontWeight"],
        letterSpacing: 1.6,
        textTransform: "uppercase" as const,
        color: color.brassDeep,
    },
    body: {
        fontFamily: font.body,
        fontSize: 15,
        fontWeight: "400" as TextStyle["fontWeight"],
        lineHeight: 22,
        color: color.ink,
    },
    meta: {
        fontFamily: font.bodyMedium,
        fontSize: 12,
        fontWeight: "500" as TextStyle["fontWeight"],
        color: color.mist,
    },
};
