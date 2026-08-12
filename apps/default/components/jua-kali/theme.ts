import { Platform, type TextStyle } from "react-native";

/** Meeting-ready “Nairobi ledger” tokens — cool stone, charcoal, brass (not cream/terracotta). */
export const color = {
    stone: "#E6E4DF",
    paper: "#F7F6F2",
    charcoal: "#141816",
    ink: "#1C2420",
    brass: "#A67C2D",
    brassSoft: "rgba(166, 124, 45, 0.14)",
    mist: "#7A827C",
    line: "rgba(20, 24, 22, 0.1)",
    lineStrong: "rgba(20, 24, 22, 0.18)",
    success: "#2F5D3A",
    danger: "#8B3A2F",
};

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
        color: color.brass,
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
