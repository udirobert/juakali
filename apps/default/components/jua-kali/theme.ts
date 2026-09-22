import { Platform, type TextStyle, type ViewStyle } from "react-native";

/** Meeting-ready “Nairobi ledger” tokens — cool stone, charcoal, brass (not cream/terracotta). */
export const color = {
    stone: "#E6E4DF",
    /** Slightly cooler field wash under the stone — sylva-style atmosphere, light lane. */
    field: "#DEDAD3",
    paper: "#F7F6F2",
    /** Warm white for text sitting on brass/charcoal fills. */
    foam: "#FFFDF7",
    charcoal: "#141816",
    ink: "#1C2420",
    brass: "#A67C2D",
    brassLight: "#C4A15A",
    brassDeep: "#7C5E22",
    brassSoft: "rgba(166, 124, 45, 0.14)",
    /** The one brass-family border tone (chips, pills, card scaffolds). */
    brassBorder: "rgba(166, 124, 45, 0.25)",
    /** Meta text — darkened to ~5.5:1 on paper for WCAG AA at small sizes. */
    mist: "#5E6660",
    /** Softer secondary label (sylva card-label lane). */
    mistSoft: "#7A817A",
    line: "rgba(20, 24, 22, 0.1)",
    lineStrong: "rgba(20, 24, 22, 0.18)",
    /** Translucent panel fill — floating dock / soft chrome. */
    panel: "rgba(247, 246, 242, 0.86)",
    panelBorder: "rgba(20, 24, 22, 0.1)",
    success: "#2F5D3A",
    danger: "#8B3A2F",
};
export type ColorTokens = typeof color;

/**
 * Radius scale — soft enough to feel contemporary (sylva dock ~14),
 * still tight enough for a ledger, not bubble UI.
 */
export const radius = {
    xs: 4,
    sm: 6,
    md: 10,
    lg: 14,
    xl: 20,
    pill: 99,
};

/**
 * Spacing rhythm — 4pt base. Prefer these over magic numbers so screens
 * share one breathing pattern (MengTo: lock the system, then iterate).
 */
export const space = {
    1: 4,
    2: 8,
    3: 12,
    4: 16,
    5: 20,
    6: 24,
    7: 32,
    8: 40,
    9: 48,
    10: 64,
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
    /**
     * The skeleton breathing loop — an idle, ambient placeholder cue, not a
     * response to a user action. Slower on purpose so it reads as "waiting for
     * live data", distinct from the sub-300ms interaction language above.
     */
    skeletonPulse: 900,
    /** Sylva-adjacent ease — soft settle, no bounce. */
    easeOut: "cubic-bezier(0.16, 1, 0.3, 1)" as const,
    ease: "cubic-bezier(0.22, 0.61, 0.36, 1)" as const,
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
    /** Soft dawn pool behind the landing sun — atmosphere, not decoration. */
    glow: "rgba(196, 161, 90, 0.22)",
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
    /** Comfortable reading measure for body copy. */
    proseWidth: 560,
};

/**
 * Elevation — reserved for artifact surfaces (digest, proposal) that must read
 * as "produced documents" rather than flat boxes. Routine cards stay flat with
 * their 1px line; this is the exception, not the default.
 */
export const elevation = {
    raised: Platform.select({
        web: {
            boxShadow: "0 1px 2px rgba(20,24,22,0.04), 0 8px 24px rgba(20,24,22,0.06)",
        },
        default: {
            shadowColor: "#141816",
            shadowOpacity: 0.07,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 3 },
            elevation: 3,
        },
    }) as ViewStyle,
    /** Floating dock / soft chrome — sylva dock shadow, light lane. */
    dock: Platform.select({
        web: {
            boxShadow:
                "0 8px 22px rgba(20,24,22,0.10), inset 0 1px 0 rgba(255,253,247,0.7)",
        },
        default: {
            shadowColor: "#141816",
            shadowOpacity: 0.1,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 4 },
            elevation: 4,
        },
    }) as ViewStyle,
};

export const type = {
    brand: {
        fontFamily: font.display,
        fontSize: 44,
        fontWeight: "700" as TextStyle["fontWeight"],
        letterSpacing: -1.6,
        color: color.charcoal,
        lineHeight: 48,
    },
    title: {
        fontFamily: font.displayMedium,
        fontSize: 28,
        fontWeight: "600" as TextStyle["fontWeight"],
        letterSpacing: -0.7,
        color: color.charcoal,
        lineHeight: 34,
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
        lineHeight: 24,
        color: color.ink,
    },
    meta: {
        fontFamily: font.bodyMedium,
        fontSize: 12,
        fontWeight: "500" as TextStyle["fontWeight"],
        color: color.mist,
    },
};

/**
 * Lab "system" tone — a neutral ink/gray set for operator surfaces (funnel,
 * ops/Lab) so functional tooling reads as *system*, not investor theater. It
 * stays inside the palette (no new hue) but trades brass's "trust" meaning for
 * a cool, tabular ink. Additive: adopted by Lab-facing primitives as needed;
 * the admin Ops face still carries its own organic legacy treatment.
 */
export const lab = {
    /** Primary system ink — near-charcoal, cooler than warm charcoal. */
    ink: "#2A322C",
    /** Neutral text — grayed-out brass meaning; no "approve" implication. */
    info: "#4A5560",
    line: color.lineStrong,
    tabular: tabularNums,
};

/**
 * Web atmosphere washes — radial light pools over stone (sylva lesson:
 * modelling comes from light, not flat fill). Applied via Atmosphere / CSS.
 */
export const atmosphere = {
    landing:
        "radial-gradient(64% 48% at 50% 18%, rgba(196,161,90,0.16) 0%, rgba(196,161,90,0) 70%), " +
        "radial-gradient(70% 55% at 88% 92%, rgba(255,253,247,0.55) 0%, rgba(255,253,247,0) 65%), " +
        "radial-gradient(55% 40% at 8% 78%, rgba(230,228,223,0.9) 0%, rgba(230,228,223,0) 60%), " +
        "#E6E4DF",
    app:
        "radial-gradient(80% 50% at 50% -10%, rgba(255,253,247,0.7) 0%, rgba(255,253,247,0) 55%), " +
        "radial-gradient(50% 40% at 100% 100%, rgba(166,124,45,0.06) 0%, rgba(166,124,45,0) 60%), " +
        "#E6E4DF",
};
