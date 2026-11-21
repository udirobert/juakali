import { StyleSheet } from "react-native";

import { color, font, radius, space, type } from "@/components/jua-kali/theme";

/**
 * "Private service book" — a private, print-like ledger for one venture lead and one
 * backer. Reuses the editorial palette but reads as a bound notebook: a brass
 * spine rule, week entries as ruled lines, and quiet ink copy.
 */
export const styles = StyleSheet.create({
    page: {
        flex: 1,
        backgroundColor: color.field,
    },
    content: {
        paddingHorizontal: space[4],
        gap: space[5],
    },
    bookCover: {
        backgroundColor: color.foam,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: color.lineStrong,
        overflow: "hidden",
    },
    bookSpine: {
        position: "absolute",
        left: 0,
        top: 0,
        bottom: 0,
        width: 6,
        backgroundColor: color.brass,
    },
    bookBody: {
        padding: space[4],
        paddingLeft: space[4] + 10,
        gap: space[2],
    },
    eyebrow: {
        ...type.eyebrow,
        color: color.brassDeep,
    },
    title: {
        ...type.title,
        fontSize: 30,
        color: color.ink,
    },
    subtitle: {
        ...type.body,
        fontSize: 15,
        lineHeight: 22,
        color: color.mist,
    },
    instruction: {
        ...type.meta,
        fontSize: 13,
        lineHeight: 18,
        color: color.charcoal,
        borderTopWidth: 1,
        borderTopColor: color.line,
        paddingTop: space[3],
    },
    exampleFlag: {
        ...type.eyebrow,
        color: color.mist,
    },
    weekRow: {
        borderTopWidth: 1,
        borderTopColor: color.line,
        paddingTop: space[3],
        marginTop: space[3],
        gap: 4,
    },
    weekHead: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "baseline",
    },
    weekLabel: {
        ...type.body,
        fontFamily: font.bodyBold,
        fontSize: 14,
        color: color.ink,
    },
    weekMeta: {
        ...type.meta,
        fontSize: 12,
        color: color.mist,
    },
    weekLine: {
        ...type.body,
        fontSize: 14,
        lineHeight: 20,
        color: color.charcoal,
    },
    weekLineQuiet: {
        ...type.body,
        fontSize: 14,
        lineHeight: 20,
        color: color.mist,
    },
    decisionCard: {
        backgroundColor: color.paper,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: color.brassBorder,
        padding: space[4],
        gap: space[3],
    },
    decisionTitle: {
        ...type.body,
        fontFamily: font.bodyBold,
        fontSize: 16,
        color: color.ink,
    },
    decisionAsk: {
        ...type.body,
        fontSize: 15,
        lineHeight: 22,
        color: color.charcoal,
    },
    decisionButtons: {
        gap: space[2],
    },
    fieldLabel: {
        ...type.meta,
        fontSize: 13,
        color: color.charcoal,
    },
    fieldHint: {
        ...type.meta,
        fontSize: 12,
        lineHeight: 17,
        color: color.mist,
    },
    chipRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: space[2],
    },
    status: {
        ...type.body,
        fontSize: 14,
        color: color.mist,
    },
    error: {
        ...type.body,
        fontSize: 14,
        color: color.danger,
    },
    inlineLink: {
        ...type.meta,
        fontSize: 13,
        color: color.brassDeep,
        textDecorationLine: "underline",
    },
    gap: { gap: space[3] },
});
