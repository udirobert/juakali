import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import type { FunctionReturnType } from "convex/server";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatKes } from "@/components/jua-kali/cockpit/format";
import { Sparkline } from "@/components/jua-kali/cockpit/sparkline";
import { useUiMotion } from "@/components/jua-kali/hooks/use-ui-motion";
import { IconArrowRight, IconCapital, IconLedger, IconSparkle } from "@/components/jua-kali/icons";
import { LivingSun } from "@/components/jua-kali/living-sun";
import { SunMark } from "@/components/jua-kali/sun-mark";
import { color, font, sun, type } from "@/components/jua-kali/theme";
import { Button, Card, PressableScale, SectionLabel } from "@/components/jua-kali/ui";

type Venture = FunctionReturnType<typeof api.invest.investorCockpit>["availableVentures"][number];

/** How many ventures the gallery shows before folding into a count line. */
const GALLERY_LIMIT = 6;

const LOOP_STEPS = [
    {
        icon: IconCapital,
        title: "Make a soft pledge",
        body: "Intent only — no escrow, no payments. You set an amount and a revenue share.",
    },
    {
        icon: IconSparkle,
        title: "Jua mentors weekly",
        body: "Check-ins, hard KPIs with evidence, and a digest that waits for your approval.",
    },
    {
        icon: IconLedger,
        title: "Proof seals in public",
        body: "Capital → actions → results, on a ledger anyone can read.",
    },
] as const;

/**
 * The desk at dawn — the Deals empty state, composed as a first experience
 * rather than a dead zone. Jua speaks first (the sun is up, the desk is
 * clear), then the ventures waiting for a backer appear as a real gallery —
 * craft, place, target, sparkline, pledges so far — each one tappable into
 * the pledge flow. The loop and the honesty footnote close the page, so an
 * empty desk still teaches what a pledge becomes.
 */
export function DealsEmptyDesk({
    ventures,
    demo,
    isSeeding,
    onSeed,
    onPledgeVenture,
    onOpenLedger,
    onOpenGlossary,
}: {
    ventures: Venture[];
    /** Demo preset — offer the seeded-deals shortcut. */
    demo: boolean;
    isSeeding: boolean;
    onSeed: () => void;
    /** Pre-selects the venture and opens the pledge form. */
    onPledgeVenture: (ventureId: Id<"ventures">) => void;
    onOpenLedger?: () => void;
    onOpenGlossary?: (focusId?: string) => void;
}) {
    const { enter } = useUiMotion();
    const shown = ventures.slice(0, GALLERY_LIMIT);
    const extra = ventures.length - shown.length;

    // Section stagger order — hero, gallery, loop, demo, footnote.
    let section = 0;
    const heroIndex = section++;
    const galleryIndex = shown.length > 0 ? section++ : -1;
    const loopIndex = section++;
    const demoIndex = demo ? section++ : -1;
    const footIndex = section;

    return (
        <View style={styles.wrap}>
            <Animated.View entering={enter(heroIndex)} style={styles.hero}>
                <View
                    style={styles.dawnStage}
                    aria-hidden
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                >
                    <View style={styles.horizon} />
                    <LivingSun size={88} agentState="observing" />
                </View>
                <Text style={styles.eyebrow}>The desk at dawn</Text>
                <Text style={styles.headline}>Nothing on my desk yet.</Text>
                <Text style={styles.voice}>
                    {shown.length > 0
                        ? "The sun is up and I'm ready to work. Back a venture below and I'll follow it every week — logging hard KPIs, writing digests you approve, and sealing each step to the public ledger."
                        : demo
                          ? "The sun is up and I'm ready to work. Load the seeded ventures below and I'll start following them — or check back when a venture opens for pledges."
                          : "The sun is up and I'm ready to work. No ventures are open for pledges yet — check back soon."}
                </Text>
            </Animated.View>

            {shown.length > 0 ? (
                <Animated.View entering={enter(galleryIndex)} style={styles.section}>
                    <View style={styles.sectionHead}>
                        <SectionLabel>Ventures open for backing</SectionLabel>
                        <Text style={styles.sectionSub}>
                            Real Jua Kali ventures — the craft, the place, and the target they're
                            working toward.
                        </Text>
                    </View>
                    <VentureGrid ventures={shown} onPledgeVenture={onPledgeVenture} />
                    {extra > 0 ? (
                        <Text style={styles.moreLine}>
                            …and {extra} more waiting. Pledge one above to begin.
                        </Text>
                    ) : null}
                </Animated.View>
            ) : null}

            <Animated.View entering={enter(loopIndex)} style={styles.section}>
                <SectionLabel>How a pledge becomes proof</SectionLabel>
                <LoopSteps />
                {onOpenLedger ? (
                    <PressableScale
                        onPress={onOpenLedger}
                        style={styles.ledgerLink}
                        accessibilityLabel="Read the public ledger"
                        accessibilityHint="Opens the Proof tab"
                    >
                        <IconLedger size={13} color={color.brassDeep} />
                        <Text style={styles.ledgerLinkText}>Read the public ledger →</Text>
                    </PressableScale>
                ) : null}
            </Animated.View>

            {demo ? (
                <Animated.View entering={enter(demoIndex)}>
                    <Card variant="trust" style={styles.demoCard}>
                        <View style={styles.demoTitleRow}>
                            <SunMark size={16} />
                            <Text style={styles.demoTitle}>Rather watch me work first?</Text>
                        </View>
                        <Text style={styles.demoBody}>
                            Load seeded deals and this desk fills in — pledges, live KPIs, a digest
                            to approve, and entries on the public ledger.
                        </Text>
                        <Button
                            label={isSeeding ? "Loading…" : "Load seeded deals"}
                            onPress={onSeed}
                            disabled={isSeeding}
                            busy={isSeeding}
                        />
                    </Card>
                </Animated.View>
            ) : null}

            <Animated.View entering={enter(footIndex)} style={styles.foot}>
                <Text style={styles.footnote}>
                    Soft pledges — intent, not escrow or live payments.
                </Text>
                {onOpenGlossary ? (
                    <PressableScale
                        onPress={() => onOpenGlossary("soft-pledge")}
                        style={styles.glossaryLink}
                        accessibilityLabel="What is a soft pledge?"
                        accessibilityHint="Opens the glossary"
                    >
                        <Text style={styles.glossaryLinkText}>What is a soft pledge?</Text>
                    </PressableScale>
                ) : null}
            </Animated.View>
        </View>
    );
}


/**
 * The venture gallery — a measured two-column grid on wide canvases, one
 * column on phones. Each card is the whole story of a venture in miniature
 * and presses straight into the pledge flow with that venture selected.
 */
function VentureGrid({
    ventures,
    onPledgeVenture,
}: {
    ventures: Venture[];
    onPledgeVenture: (ventureId: Id<"ventures">) => void;
}) {
    const [gridWidth, setGridWidth] = useState(0);
    const gap = 12;
    const twoCol = gridWidth >= 620;
    const cardWidth = twoCol ? (gridWidth - gap) / 2 : gridWidth;

    return (
        <View
            style={styles.grid}
            onLayout={(event) => setGridWidth(event.nativeEvent.layout.width)}
        >
            {gridWidth > 0
                ? ventures.map((venture) => (
                      <VentureCard
                          key={venture.id}
                          venture={venture}
                          width={cardWidth}
                          onPress={() => onPledgeVenture(venture.id)}
                      />
                  ))
                : null}
        </View>
    );
}

function VentureCard({
    venture,
    width,
    onPress,
}: {
    venture: Venture;
    width: number;
    onPress: () => void;
}) {
    const progress =
        venture.kpiTarget > 0 ? Math.min(1, venture.kpiTotal / venture.kpiTarget) : 0;
    const pct = Math.round(progress * 100);

    return (
        <PressableScale
            onPress={onPress}
            style={{ width }}
            accessibilityLabel={`${venture.name} — ${venture.craftText}, ${venture.locationText}`}
            accessibilityHint="Opens the pledge form with this venture selected"
        >
            <View style={styles.ventureCard}>
                <View style={styles.ventureTop}>
                    <Text style={styles.ventureName} numberOfLines={1}>
                        {venture.name}
                    </Text>
                </View>
                <Text style={styles.ventureMeta} numberOfLines={1}>
                    {venture.craftText} · {venture.locationText}
                </Text>
                <Text style={styles.ventureSummary} numberOfLines={2}>
                    {venture.summary}
                </Text>

                {venture.sparkline.length > 1 ? (
                    <Sparkline values={venture.sparkline} height={30} />
                ) : null}

                <View style={styles.kpiBlock}>
                    <View style={styles.kpiRow}>
                        <Text style={styles.kpiLabel} numberOfLines={1}>
                            {venture.kpiLabel}
                        </Text>
                        <Text style={styles.kpiNums}>
                            {venture.kpiTotal.toLocaleString()} /{" "}
                            {venture.kpiTarget.toLocaleString()}
                            {venture.kpiTarget > 0 ? ` · ${pct}%` : ""}
                        </Text>
                    </View>
                    <View style={styles.progressTrack}>
                        <View style={[styles.progressFill, { width: `${pct}%` }]} />
                    </View>
                </View>

                <View style={styles.ventureRule} />

                <View style={styles.ventureFoot}>
                    <Text style={styles.pledged} numberOfLines={1}>
                        {venture.pledgedKes > 0
                            ? `${formatKes(venture.pledgedKes)} pledged`
                            : "No pledges yet — be the first"}
                    </Text>
                    <View style={styles.pledgeCta}>
                        <Text style={styles.pledgeCtaText}>Pledge</Text>
                        <IconArrowRight size={13} color={color.brassDeep} />
                    </View>
                </View>
            </View>
        </PressableScale>
    );
}


/** The loop — three glyph-marked steps; a row on wide canvases, a stack on phones. */
function LoopSteps() {
    const [width, setWidth] = useState(0);
    const row = width >= 620;

    return (
        <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
            <Card>
                <View style={[styles.loop, row && styles.loopRow]}>
                    {LOOP_STEPS.map((step, i) => {
                        const StepIcon = step.icon;
                        return (
                            <View
                                key={step.title}
                                style={[
                                    styles.loopStep,
                                    row && styles.loopStepRow,
                                    !row && i > 0 && styles.loopStepStacked,
                                ]}
                            >
                                <View style={styles.loopBadge}>
                                    <StepIcon size={15} color={color.brassDeep} />
                                </View>
                                <View style={styles.loopCopy}>
                                    <Text style={styles.loopTitle}>{step.title}</Text>
                                    <Text style={styles.loopBody}>{step.body}</Text>
                                </View>
                            </View>
                        );
                    })}
                </View>
            </Card>
        </View>
    );
}


const styles = StyleSheet.create({
    // One centered composed column — a page, not a list pinned to the top.
    wrap: { alignItems: "center", gap: 30, paddingVertical: 22 },
    section: { width: "100%", maxWidth: 720, gap: 10 },
    sectionHead: { gap: 4 },
    sectionSub: { ...type.body, fontSize: 13, lineHeight: 19, color: color.mist },

    // Dawn hero — the sun at first light, sitting on its horizon hairline.
    hero: { alignItems: "center", gap: 12, maxWidth: 560 },
    dawnStage: { alignItems: "center", justifyContent: "center" },
    horizon: {
        position: "absolute",
        left: -44,
        right: -44,
        top: "50%",
        height: 1,
        backgroundColor: sun.horizon,
    },
    eyebrow: { ...type.eyebrow },
    headline: {
        ...type.title,
        fontSize: 30,
        lineHeight: 36,
        textAlign: "center",
    },
    voice: {
        ...type.body,
        fontSize: 15,
        lineHeight: 23,
        color: color.mist,
        textAlign: "center",
        maxWidth: 500,
    },

    // Venture gallery
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
    ventureCard: {
        gap: 9,
        padding: 14,
        borderRadius: 6,
        backgroundColor: color.paper,
        borderWidth: 1,
        borderColor: color.line,
    },
    ventureTop: { flexDirection: "row", alignItems: "center", gap: 8 },
    ventureName: {
        fontFamily: font.displayMedium,
        fontSize: 17,
        fontWeight: "600",
        letterSpacing: -0.3,
        color: color.charcoal,
        flex: 1,
    },
    ventureMeta: { fontFamily: font.body, fontSize: 12, lineHeight: 16, color: color.mist },
    ventureSummary: { fontFamily: font.body, fontSize: 13, lineHeight: 19, color: color.ink },
    kpiBlock: { gap: 5 },
    kpiRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
    kpiLabel: {
        fontFamily: font.bodyBold,
        fontSize: 10,
        fontWeight: "700",
        letterSpacing: 0.6,
        textTransform: "uppercase",
        color: color.mist,
        flexShrink: 1,
    },
    kpiNums: {
        fontFamily: font.bodyBold,
        fontSize: 11,
        fontWeight: "700",
        color: color.charcoal,
        fontVariant: ["tabular-nums"],
    },
    progressTrack: {
        height: 3,
        borderRadius: 2,
        backgroundColor: "rgba(20,24,22,0.08)",
        overflow: "hidden",
    },
    progressFill: { height: "100%", backgroundColor: color.brass },
    ventureRule: { height: 1, backgroundColor: color.line },
    ventureFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
    pledged: {
        fontFamily: font.body,
        fontSize: 11,
        color: color.mist,
        fontVariant: ["tabular-nums"],
        flexShrink: 1,
    },
    pledgeCta: { flexDirection: "row", alignItems: "center", gap: 4 },
    pledgeCtaText: {
        fontFamily: font.bodyBold,
        fontSize: 12,
        fontWeight: "700",
        color: color.brassDeep,
    },
    moreLine: {
        fontFamily: font.body,
        fontSize: 12,
        color: color.mist,
        textAlign: "center",
    },


    // The loop
    loop: { gap: 14 },
    loopRow: { flexDirection: "row", gap: 18 },
    loopStep: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
    loopStepRow: { flex: 1 },
    loopStepStacked: { borderTopWidth: 1, borderTopColor: color.line, paddingTop: 14 },
    loopBadge: {
        width: 30,
        height: 30,
        borderRadius: 15,
        borderWidth: 1,
        borderColor: color.brassBorder,
        backgroundColor: color.brassSoft,
        alignItems: "center",
        justifyContent: "center",
    },
    loopCopy: { flex: 1, gap: 2 },
    loopTitle: { fontFamily: font.bodyBold, fontSize: 13, fontWeight: "700", color: color.ink },
    loopBody: { fontFamily: font.body, fontSize: 12, lineHeight: 17, color: color.mist },
    ledgerLink: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        paddingVertical: 4,
    },
    ledgerLinkText: {
        fontFamily: font.bodyBold,
        fontSize: 12,
        fontWeight: "700",
        color: color.brassDeep,
    },

    // Demo shortcut — Jua's trust card.
    demoCard: { width: "100%", maxWidth: 720, gap: 10 },
    demoTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    demoTitle: {
        fontFamily: font.displayMedium,
        fontSize: 17,
        fontWeight: "600",
        color: color.charcoal,
    },
    demoBody: { fontFamily: font.body, fontSize: 13, lineHeight: 19, color: color.ink },

    // Honesty footnote
    foot: { alignItems: "center", gap: 6 },
    footnote: {
        fontFamily: font.body,
        fontSize: 11,
        lineHeight: 16,
        color: color.mist,
        textAlign: "center",
    },
    glossaryLink: { paddingVertical: 2 },
    glossaryLinkText: {
        fontFamily: font.bodyBold,
        fontSize: 11,
        fontWeight: "700",
        color: color.brassDeep,
    },
});

