import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    useWindowDimensions,
    View,
} from "react-native";
import type { ViewStyle } from "react-native";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
    Easing,
    FadeIn,
    FadeInDown,
    FadeInUp,
    FadeOut,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withDelay,
    withRepeat,
    withSequence,
    withTiming,
} from "react-native-reanimated";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";

import { api } from "@/convex/_generated/api";

type InterviewResult = FunctionReturnType<typeof api.telephony.runApprenticeInterview>;
type MatchResult = InterviewResult["matches"][number];
type WebShapeStyle = ViewStyle & { clipPath?: string; backdropFilter?: string };

const palette = {
    sage: "#9CAF88",
    terracotta: "#E07A5F",
    cream: "#F5F1E8",
    olive: "#3B4D3B",
    ink: "#243124",
    moss: "#71845F",
    sand: "#E7D8C5",
};

const headingFont = Platform.select({ web: "Equipment, Inter, Avenir Next, system-ui, sans-serif", default: "System" });
const bodyFont = Platform.select({ web: "Inter, Avenir, system-ui, sans-serif", default: "System" });

const crafts = [
    { label: "Metalwork", hint: "Welding, gates, fabrication" },
    { label: "Carpentry", hint: "Furniture, joinery, repair" },
    { label: "Tailoring", hint: "Garments, patterns, uniforms" },
    { label: "Mechanics", hint: "Engines, diagnostics, bikes" },
    { label: "Electrical", hint: "Wiring, solar, installs" },
    { label: "Masonry", hint: "Building, plaster, tiling" },
];

const locations = ["Kariobangi", "Kisumu", "Mombasa", "Thika", "Eldoret", "Nakuru"];

const clipBlobStyle: WebShapeStyle = {
    clipPath: "polygon(12% 0%, 100% 8%, 90% 94%, 0% 100%)",
};

type StepKey = "welcome" | "role" | "craft" | "location" | "building" | "reveal";

export function Onboarding({ onEnterDashboard }: { onEnterDashboard: () => void }) {
    const runInterview = useMutation(api.telephony.runApprenticeInterview);
    const insets = useSafeAreaInsets();
    const { height } = useWindowDimensions();
    const reducedMotion = useReducedMotion();

    const [step, setStep] = useState<StepKey>("welcome");
    const [craft, setCraft] = useState<string | null>(null);
    const [location, setLocation] = useState<string | null>(null);
    const [customLocation, setCustomLocation] = useState("");
    const [result, setResult] = useState<InterviewResult | null>(null);
    const [errorText, setErrorText] = useState<string | null>(null);
    const buildingRef = useRef(false);

    const orderedSteps: StepKey[] = useMemo(() => ["welcome", "role", "craft", "location", "building", "reveal"], []);
    const progressIndex = orderedSteps.indexOf(step);

    const resolvedLocation = location ?? (customLocation.trim().length > 0 ? customLocation.trim() : null);

    const buildPlan = useCallback(async () => {
        if (buildingRef.current || !craft || !resolvedLocation) return;
        buildingRef.current = true;
        setErrorText(null);
        setStep("building");
        const startedAt = Date.now();
        try {
            const data = await runInterview({ phoneNumber: "", craftText: craft, locationText: resolvedLocation });
            const elapsed = Date.now() - startedAt;
            const minDelay = reducedMotion ? 0 : 1850;
            if (elapsed < minDelay) await new Promise((resolve) => setTimeout(resolve, minDelay - elapsed));
            setResult(data);
            setStep("reveal");
        } catch (error) {
            setErrorText(error instanceof Error ? error.message : "We couldn't build your plan. Try again.");
            setStep("location");
        } finally {
            buildingRef.current = false;
        }
    }, [craft, resolvedLocation, runInterview, reducedMotion]);

    useEffect(() => {
        if (step === "location" && resolvedLocation && craft && !result) {
            // no auto-advance; advance handled by button
        }
    }, [step, resolvedLocation, craft, result]);

    async function tap() {
        if (Platform.OS === "web") return;
        await Haptics.selectionAsync();
    }

    return (
        <View style={styles.screen}>
            <OrganicBackdrop />
            <View style={[styles.frame, { paddingTop: insets.top + 14, paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
                <View style={styles.topBar}>
                    <ProgressTrack total={orderedSteps.length - 1} index={Math.min(progressIndex, orderedSteps.length - 1)} />
                    {step !== "welcome" && step !== "building" ? (
                        <Pressable accessibilityRole="button" onPress={onEnterDashboard} hitSlop={10} style={styles.skipButton}>
                            <Text style={styles.skipText}>Admin view</Text>
                        </Pressable>
                    ) : (
                        <View style={{ width: 1 }} />
                    )}
                </View>

                <View style={styles.stage}>
                    {step === "welcome" ? (
                        <WelcomeStep
                            height={height}
                            onStart={async () => {
                                await tap();
                                setStep("role");
                            }}
                            onAdmin={onEnterDashboard}
                        />
                    ) : null}

                    {step === "role" ? (
                        <RoleStep
                            onApprentice={async () => {
                                await tap();
                                setStep("craft");
                            }}
                            onMaster={onEnterDashboard}
                        />
                    ) : null}

                    {step === "craft" ? (
                        <CraftStep
                            selected={craft}
                            onSelect={async (value) => {
                                await tap();
                                setCraft(value);
                                setStep("location");
                            }}
                        />
                    ) : null}

                    {step === "location" ? (
                        <LocationStep
                            craft={craft ?? "your craft"}
                            selected={location}
                            custom={customLocation}
                            errorText={errorText}
                            onSelect={async (value) => {
                                await tap();
                                setLocation(value);
                                setCustomLocation("");
                            }}
                            onChangeCustom={(value) => {
                                setLocation(null);
                                setCustomLocation(value);
                            }}
                            canContinue={Boolean(resolvedLocation)}
                            onContinue={buildPlan}
                        />
                    ) : null}

                    {step === "building" ? <BuildingStep craft={craft ?? ""} location={resolvedLocation ?? ""} /> : null}

                    {step === "reveal" && result ? (
                        <RevealStep
                            craft={craft ?? ""}
                            location={resolvedLocation ?? ""}
                            result={result}
                            onEnter={async () => {
                                await tap();
                                onEnterDashboard();
                            }}
                            onRestart={async () => {
                                await tap();
                                setResult(null);
                                setCraft(null);
                                setLocation(null);
                                setCustomLocation("");
                                setStep("craft");
                            }}
                        />
                    ) : null}
                </View>
            </View>
        </View>
    );
}

function Mascot({ size = 96, talking = false }: { size?: number; talking?: boolean }) {
    const reducedMotion = useReducedMotion();
    const bob = useSharedValue(0);
    const blink = useSharedValue(1);

    useEffect(() => {
        if (reducedMotion) return;
        bob.value = withRepeat(withSequence(withTiming(-6, { duration: 1200, easing: Easing.inOut(Easing.quad) }), withTiming(0, { duration: 1200, easing: Easing.inOut(Easing.quad) })), -1, false);
        blink.value = withRepeat(withSequence(withDelay(2200, withTiming(0.1, { duration: 90 })), withTiming(1, { duration: 90 })), -1, false);
    }, [bob, blink, reducedMotion]);

    const bodyStyle = useAnimatedStyle(() => ({ transform: [{ translateY: bob.value }] }));
    const eyeStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: blink.value }] }));

    return (
        <Animated.View style={[{ width: size, height: size * 1.08 }, bodyStyle]}>
            <LinearGradient
                colors={[palette.sage, "#86A06F", palette.olive]}
                start={{ x: 0.1, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.mascotBody, { width: size, height: size }]}
            />
            <View style={[styles.mascotCheek, { left: size * 0.16, top: size * 0.56 }]} />
            <View style={[styles.mascotCheek, { right: size * 0.16, top: size * 0.56 }]} />
            <Animated.View style={[styles.mascotEye, { left: size * 0.28, top: size * 0.4 }, eyeStyle]} />
            <Animated.View style={[styles.mascotEye, { right: size * 0.28, top: size * 0.4 }, eyeStyle]} />
            <View style={[styles.mascotSpark, { right: -size * 0.06, top: -size * 0.04 }]} />
            <View style={[styles.mascotSpark, styles.mascotSparkSmall, { left: -size * 0.02, top: size * 0.2 }]} />
            {talking ? <View style={[styles.mascotMouthTalk, { left: size * 0.4, top: size * 0.66 }]} /> : <View style={[styles.mascotMouth, { left: size * 0.39, top: size * 0.68 }]} />}
        </Animated.View>
    );
}

function SpeechBubble({ children }: { children: string }) {
    return (
        <Animated.View entering={FadeInDown.duration(280)} style={styles.bubble}>
            <Text style={styles.bubbleText}>{children}</Text>
            <View style={styles.bubbleTail} />
        </Animated.View>
    );
}

function WelcomeStep({ height, onStart, onAdmin }: { height: number; onStart: () => void; onAdmin: () => void }) {
    const compact = height < 720;
    const tiny = height < 660;
    const titleSize = tiny ? 33 : compact ? 39 : 46;
    const mascotSize = tiny ? 78 : compact ? 92 : 112;
    return (
        <Animated.View entering={FadeIn.duration(320)} exiting={FadeOut.duration(150)} style={styles.welcomeWrap}>
            <View style={styles.welcomeHeader}>
                <Mascot size={mascotSize} talking />
                <SpeechBubble>Karibu! I&apos;m Fundi. Let&apos;s find you a master artisan in 30 seconds.</SpeechBubble>
            </View>
            <View style={styles.welcomeCopy}>
                <Text style={styles.kicker}>Jua Kali · learn a trade</Text>
                <Text style={[styles.bigTitle, { fontSize: titleSize, lineHeight: titleSize, marginLeft: tiny ? -14 : -22 }]}>Learn a real{"\n"}skill from a{"\n"}real fundi.</Text>
                {!tiny ? (
                    <Text numberOfLines={3} style={styles.lead}>Pick a craft, tell us where you are, and we&apos;ll match you with masters teaching near you — by SMS, USSD, or voice.</Text>
                ) : null}
            </View>
            <SocialProofBand />
            <View style={styles.welcomeActions}>
                <PrimaryButton label="Start matching" onPress={onStart} />
                <Pressable accessibilityRole="button" onPress={onAdmin} hitSlop={8} style={styles.ghostLink}>
                    <Text style={styles.ghostLinkText}>I run the program →</Text>
                </Pressable>
            </View>
        </Animated.View>
    );
}

const testimonials = [
    { quote: "Nilipata fundi wa welding karibu nami in one day.", name: "Brian · Kariobangi" },
    { quote: "My master taught me tailoring — now I earn daily.", name: "Achieng · Kisumu" },
    { quote: "USSD ilinitafutia carpenter bila smartphone.", name: "Otieno · Thika" },
];

function CountUp({ to, suffix = "" }: { to: number; suffix?: string }) {
    const reducedMotion = useReducedMotion();
    const [value, setValue] = useState(reducedMotion ? to : 0);
    useEffect(() => {
        if (reducedMotion) {
            setValue(to);
            return;
        }
        let raf = 0;
        const start = Date.now();
        const duration = 1300;
        const tick = () => {
            const t = Math.min(1, (Date.now() - start) / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            setValue(Math.round(to * eased));
            if (t < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [to, reducedMotion]);
    return (
        <Text style={styles.statValue}>
            {value.toLocaleString()}
            {suffix}
        </Text>
    );
}

function StatPill({ value, suffix, label, tone, delay }: { value: number; suffix?: string; label: string; tone: "terracotta" | "olive" | "sage"; delay: number }) {
    const toneStyle = tone === "terracotta" ? styles.statPillTerracotta : tone === "olive" ? styles.statPillOlive : styles.statPillSage;
    return (
        <Animated.View entering={FadeInUp.delay(delay).duration(360)} style={[styles.statPill, toneStyle]}>
            <CountUp to={value} suffix={suffix} />
            <Text style={styles.statLabel}>{label}</Text>
        </Animated.View>
    );
}

function RotatingTestimonial() {
    const reducedMotion = useReducedMotion();
    const [index, setIndex] = useState(0);
    useEffect(() => {
        if (reducedMotion) return;
        const id = setInterval(() => setIndex((prev) => (prev + 1) % testimonials.length), 3600);
        return () => clearInterval(id);
    }, [reducedMotion]);
    const item = testimonials[index];
    return (
        <View style={styles.testimonialCard}>
            <Text style={styles.stars}>★★★★★</Text>
            <Animated.View key={index} entering={FadeIn.duration(420)}>
                <Text style={styles.testimonialQuote}>“{item.quote}”</Text>
                <Text style={styles.testimonialName}>{item.name}</Text>
            </Animated.View>
        </View>
    );
}

function SocialProofBand() {
    return (
        <View style={styles.proofBand}>
            <RotatingTestimonial />
            <View style={styles.statRow}>
                <StatPill value={1240} suffix="+" label="matched" tone="terracotta" delay={0} />
                <StatPill value={320} label="masters" tone="olive" delay={120} />
                <StatPill value={12} label="trades" tone="sage" delay={240} />
            </View>
        </View>
    );
}

function RoleStep({ onApprentice, onMaster }: { onApprentice: () => void; onMaster: () => void }) {
    return (
        <Animated.View entering={FadeInUp.duration(300)} exiting={FadeOut.duration(140)} style={styles.stepWrap}>
            <View style={styles.stepHeader}>
                <Mascot size={70} talking />
                <SpeechBubble>First — who are you today?</SpeechBubble>
            </View>
            <Text style={styles.stepTitle}>What brings you here?</Text>
            <View style={styles.roleStack}>
                <RoleCard
                    emoji="🔨"
                    title="I want to learn"
                    body="Match me with a master artisan teaching my craft nearby."
                    tone="terracotta"
                    onPress={onApprentice}
                />
                <RoleCard
                    emoji="⭐"
                    title="I teach a craft"
                    body="I'm a master ready to take on apprentices."
                    tone="olive"
                    onPress={onMaster}
                />
            </View>
        </Animated.View>
    );
}

function CraftStep({ selected, onSelect }: { selected: string | null; onSelect: (value: string) => void }) {
    return (
        <Animated.View entering={FadeInUp.duration(300)} exiting={FadeOut.duration(140)} style={styles.stepWrap}>
            <View style={styles.stepHeader}>
                <Mascot size={70} talking />
                <SpeechBubble>Nice. Which trade do you want to master?</SpeechBubble>
            </View>
            <Text style={styles.stepTitle}>Choose your craft</Text>
            <View style={styles.craftGrid}>
                {crafts.map((item, index) => {
                    const active = selected === item.label;
                    return (
                        <Animated.View key={item.label} entering={FadeInUp.delay(index * 45).duration(260)} style={styles.craftCell}>
                            <Pressable
                                accessibilityRole="button"
                                onPress={() => onSelect(item.label)}
                                style={({ pressed }) => [styles.craftChip, active && styles.craftChipActive, pressed && styles.pressed]}
                            >
                                <Text style={[styles.craftChipTitle, active && styles.craftChipTitleActive]}>{item.label}</Text>
                                <Text style={[styles.craftChipHint, active && styles.craftChipHintActive]}>{item.hint}</Text>
                            </Pressable>
                        </Animated.View>
                    );
                })}
            </View>
        </Animated.View>
    );
}

function LocationStep({
    craft,
    selected,
    custom,
    errorText,
    onSelect,
    onChangeCustom,
    canContinue,
    onContinue,
}: {
    craft: string;
    selected: string | null;
    custom: string;
    errorText: string | null;
    onSelect: (value: string) => void;
    onChangeCustom: (value: string) => void;
    canContinue: boolean;
    onContinue: () => void;
}) {
    return (
        <Animated.View entering={FadeInUp.duration(300)} exiting={FadeOut.duration(140)} style={styles.stepWrap}>
            <View style={styles.stepHeader}>
                <Mascot size={70} talking />
                <SpeechBubble>{`Where should I look for ${craft.toLowerCase()} masters?`}</SpeechBubble>
            </View>
            <Text style={styles.stepTitle}>Your area</Text>
            <View style={styles.locationGrid}>
                {locations.map((place, index) => {
                    const active = selected === place;
                    return (
                        <Animated.View key={place} entering={FadeInUp.delay(index * 40).duration(240)}>
                            <Pressable
                                accessibilityRole="button"
                                onPress={() => onSelect(place)}
                                style={({ pressed }) => [styles.placeChip, active && styles.placeChipActive, pressed && styles.pressed]}
                            >
                                <Text style={[styles.placeChipText, active && styles.placeChipTextActive]}>{place}</Text>
                            </Pressable>
                        </Animated.View>
                    );
                })}
            </View>
            <TextInput
                value={custom}
                onChangeText={onChangeCustom}
                placeholder="Or type another town…"
                placeholderTextColor="rgba(36,49,36,0.4)"
                style={styles.input}
                returnKeyType="done"
                onSubmitEditing={() => canContinue && onContinue()}
            />
            {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
            <View style={styles.continueRow}>
                <PrimaryButton label="Build my plan" onPress={onContinue} disabled={!canContinue} />
            </View>
        </Animated.View>
    );
}

function BuildingStep({ craft, location }: { craft: string; location: string }) {
    const lines = useMemo(
        () => [
            `Scanning ${craft.toLowerCase()} masters…`,
            `Filtering near ${location}…`,
            "Ranking by craft + distance…",
            "Drafting your intro SMS…",
        ],
        [craft, location]
    );
    return (
        <Animated.View entering={FadeIn.duration(240)} style={styles.buildingWrap}>
            <Mascot size={120} talking />
            <Text style={styles.buildingTitle}>Building your plan</Text>
            <View style={styles.buildingLines}>
                {lines.map((line, index) => (
                    <Animated.View key={line} entering={FadeInUp.delay(index * 380).duration(360)} style={styles.buildingLine}>
                        <View style={styles.buildingDot} />
                        <Text style={styles.buildingLineText}>{line}</Text>
                    </Animated.View>
                ))}
            </View>
            <ActivityIndicator color={palette.terracotta} />
        </Animated.View>
    );
}

function RevealStep({
    craft,
    location,
    result,
    onEnter,
    onRestart,
}: {
    craft: string;
    location: string;
    result: InterviewResult;
    onEnter: () => void;
    onRestart: () => void;
}) {
    const hasMatches = result.matches.length > 0;
    return (
        <Animated.View entering={FadeIn.duration(280)} style={styles.revealWrap}>
            <View style={styles.revealHeader}>
                <Mascot size={64} talking />
                <SpeechBubble>{hasMatches ? "Hongera! Here&apos;s your match." : "No master yet — but you&apos;re in the queue."}</SpeechBubble>
            </View>
            <Text style={styles.revealTitle}>{hasMatches ? `${result.matches.length} master${result.matches.length > 1 ? "s" : ""} for ${craft}` : `Searching ${craft} near ${location}`}</Text>
            <View style={styles.matchList}>
                {hasMatches ? (
                    result.matches.slice(0, 2).map((match, index) => <MatchCard key={match.id} match={match} index={index} />)
                ) : (
                    <View style={styles.emptyReveal}>
                        <Text style={styles.emptyRevealText}>We&apos;ll alert masters joining near {location}. Seed demo data from the admin view to preview a live match.</Text>
                    </View>
                )}
            </View>
            <View style={styles.revealActions}>
                <PrimaryButton label="Enter the program" onPress={onEnter} />
                <Pressable accessibilityRole="button" onPress={onRestart} hitSlop={8} style={styles.ghostLink}>
                    <Text style={styles.ghostLinkText}>Try another craft</Text>
                </Pressable>
            </View>
        </Animated.View>
    );
}

function MatchCard({ match, index }: { match: MatchResult; index: number }) {
    return (
        <Animated.View entering={FadeInUp.delay(index * 140).duration(420)} style={[styles.matchCard, index % 2 === 1 && styles.matchCardOffset]}>
            <LinearGradient
                colors={index === 0 ? [palette.terracotta, "#C9633F"] : [palette.sage, palette.olive]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.matchBadge, clipBlobStyle]}
            >
                <Text style={styles.matchBadgeText}>{match.name.charAt(0)}</Text>
            </LinearGradient>
            <View style={styles.matchBody}>
                <View style={styles.matchTopline}>
                    <Text style={styles.matchName}>{match.name}</Text>
                    <View style={styles.scorePill}>
                        <Text style={styles.scorePillText}>{match.score}</Text>
                    </View>
                </View>
                <Text style={styles.matchMeta}>{match.craftText} · {match.locationText}</Text>
                <Text numberOfLines={2} style={styles.matchSummary}>{match.profileSummary}</Text>
                <Text style={styles.matchSkills}>{match.keySkills.slice(0, 3).join(" · ")}</Text>
            </View>
        </Animated.View>
    );
}

function RoleCard({ emoji, title, body, tone, onPress }: { emoji: string; title: string; body: string; tone: "terracotta" | "olive"; onPress: () => void }) {
    return (
        <Pressable
            accessibilityRole="button"
            onPress={onPress}
            style={({ pressed }) => [styles.roleCard, tone === "terracotta" ? styles.roleCardTerracotta : styles.roleCardOlive, pressed && styles.pressed]}
        >
            <Text style={styles.roleEmoji}>{emoji}</Text>
            <View style={styles.roleCopy}>
                <Text style={styles.roleTitle}>{title}</Text>
                <Text style={styles.roleBody}>{body}</Text>
            </View>
            <Text style={styles.roleArrow}>→</Text>
        </Pressable>
    );
}

function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
    return (
        <Pressable
            accessibilityRole="button"
            disabled={disabled}
            onPress={onPress}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryPressed, disabled && styles.primaryDisabled]}
        >
            <LinearGradient colors={[palette.terracotta, "#C9633F"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            <Text style={styles.primaryLabel}>{label}</Text>
        </Pressable>
    );
}

function ProgressTrack({ total, index }: { total: number; index: number }) {
    return (
        <View style={styles.progressTrack}>
            {Array.from({ length: total }).map((_, i) => {
                const active = i < index;
                const current = i === index;
                return <View key={i} style={[styles.progressPip, active && styles.progressPipDone, current && styles.progressPipCurrent]} />;
            })}
        </View>
    );
}

function OrganicBackdrop() {
    return (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <LinearGradient colors={[palette.cream, "#EFE2D1", "#DCE5D2"]} style={StyleSheet.absoluteFill} />
            <View style={[styles.blob, styles.blobOne]} />
            <View style={[styles.blob, styles.blobTwo]} />
            <View style={[styles.blob, styles.blobThree]} />
            <View style={styles.noise} />
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: palette.cream },
    frame: { flex: 1, paddingHorizontal: 20 },
    topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
    progressTrack: { flexDirection: "row", gap: 7, alignItems: "center" },
    progressPip: { width: 22, height: 6, borderRadius: 3, backgroundColor: "rgba(59,77,59,0.16)" },
    progressPipDone: { backgroundColor: palette.sage },
    progressPipCurrent: { backgroundColor: palette.terracotta, width: 30 },
    skipButton: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: "rgba(59,77,59,0.08)" },
    skipText: { color: palette.olive, fontFamily: bodyFont, fontSize: 12, fontWeight: "700" },
    stage: { flex: 1, justifyContent: "center" },

    welcomeWrap: { flex: 1, paddingVertical: 6, gap: 14 },
    welcomeHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginTop: 6 },
    welcomeCopy: { gap: 12 },
    kicker: { color: palette.terracotta, fontFamily: bodyFont, fontSize: 12, fontWeight: "700", letterSpacing: 1.6, textTransform: "uppercase", marginLeft: -2 },
    bigTitle: { color: palette.olive, fontFamily: headingFont, fontSize: 46, fontWeight: "800", lineHeight: 46, letterSpacing: -2, marginLeft: -34 },
    bigTitleCompact: { fontSize: 38, lineHeight: 39, marginLeft: -26 },
    lead: { color: palette.ink, fontFamily: bodyFont, fontSize: 16, fontWeight: "300", lineHeight: 24, maxWidth: 420 },
    welcomeActions: { gap: 12, alignItems: "flex-start" },

    stepWrap: { flex: 1, justifyContent: "flex-start", gap: 16, paddingTop: 4 },
    stepHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
    stepTitle: { color: palette.olive, fontFamily: headingFont, fontSize: 30, fontWeight: "800", letterSpacing: -1, marginLeft: -20 },

    roleStack: { gap: 14, marginTop: 4 },
    roleCard: { flexDirection: "row", alignItems: "center", gap: 14, padding: 18, borderTopLeftRadius: 34, borderTopRightRadius: 12, borderBottomLeftRadius: 14, borderBottomRightRadius: 40, boxShadow: "0 18px 32px rgba(59,77,59,0.16)" },
    roleCardTerracotta: { backgroundColor: "rgba(224,122,95,0.16)", borderWidth: 1, borderColor: "rgba(224,122,95,0.4)" },
    roleCardOlive: { backgroundColor: "rgba(156,175,136,0.18)", borderWidth: 1, borderColor: "rgba(59,77,59,0.22)" },
    roleEmoji: { fontSize: 34 },
    roleCopy: { flex: 1, gap: 3 },
    roleTitle: { color: palette.ink, fontFamily: headingFont, fontSize: 19, fontWeight: "800" },
    roleBody: { color: "rgba(36,49,36,0.7)", fontFamily: bodyFont, fontSize: 13, fontWeight: "300", lineHeight: 18 },
    roleArrow: { color: palette.terracotta, fontSize: 22, fontWeight: "900" },

    craftGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 2 },
    craftCell: { width: "47.5%" },
    craftChip: { gap: 4, padding: 14, minHeight: 78, borderTopLeftRadius: 26, borderTopRightRadius: 10, borderBottomLeftRadius: 12, borderBottomRightRadius: 28, backgroundColor: "rgba(255,253,247,0.78)", borderWidth: 1, borderColor: "rgba(59,77,59,0.14)", boxShadow: "0 12px 22px rgba(59,77,59,0.1)" },
    craftChipActive: { backgroundColor: palette.olive, borderColor: palette.olive },
    craftChipTitle: { color: palette.ink, fontFamily: headingFont, fontSize: 17, fontWeight: "800" },
    craftChipTitleActive: { color: "#FFFDF7" },
    craftChipHint: { color: "rgba(36,49,36,0.62)", fontFamily: bodyFont, fontSize: 12, fontWeight: "300", lineHeight: 16 },
    craftChipHintActive: { color: "rgba(255,253,247,0.82)" },

    locationGrid: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
    placeChip: { paddingHorizontal: 16, paddingVertical: 11, borderRadius: 22, borderTopLeftRadius: 6, backgroundColor: "rgba(255,253,247,0.78)", borderWidth: 1, borderColor: "rgba(59,77,59,0.16)" },
    placeChipActive: { backgroundColor: palette.terracotta, borderColor: palette.terracotta },
    placeChipText: { color: palette.ink, fontFamily: bodyFont, fontSize: 14, fontWeight: "700" },
    placeChipTextActive: { color: "#FFFDF7" },
    input: { marginTop: 4, paddingHorizontal: 16, paddingVertical: 13, borderRadius: 18, borderTopLeftRadius: 6, backgroundColor: "rgba(255,253,247,0.9)", borderWidth: 1, borderColor: "rgba(59,77,59,0.18)", color: palette.ink, fontFamily: bodyFont, fontSize: 15 },
    continueRow: { marginTop: 6, alignItems: "flex-start" },
    errorText: { color: palette.terracotta, fontFamily: bodyFont, fontSize: 13, fontWeight: "700" },

    buildingWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 18 },
    buildingTitle: { color: palette.olive, fontFamily: headingFont, fontSize: 28, fontWeight: "800", letterSpacing: -0.8 },
    buildingLines: { gap: 10, alignSelf: "stretch", paddingHorizontal: 20 },
    buildingLine: { flexDirection: "row", alignItems: "center", gap: 10 },
    buildingDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: palette.terracotta },
    buildingLineText: { color: palette.ink, fontFamily: bodyFont, fontSize: 15, fontWeight: "300" },

    revealWrap: { flex: 1, justifyContent: "flex-start", gap: 14, paddingTop: 4 },
    revealHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
    revealTitle: { color: palette.olive, fontFamily: headingFont, fontSize: 28, fontWeight: "800", letterSpacing: -1, marginLeft: -18 },
    matchList: { gap: 14, flex: 1 },
    matchCard: { flexDirection: "row", gap: 13, padding: 14, backgroundColor: "rgba(255,253,247,0.82)", borderTopLeftRadius: 30, borderTopRightRadius: 12, borderBottomLeftRadius: 14, borderBottomRightRadius: 34, borderWidth: 1, borderColor: "rgba(59,77,59,0.12)", boxShadow: "0 18px 30px rgba(59,77,59,0.14)" },
    matchCardOffset: { marginLeft: "7%" },
    matchBadge: { width: 58, height: 58, alignItems: "center", justifyContent: "center" },
    matchBadgeText: { color: "#FFFDF7", fontFamily: headingFont, fontSize: 26, fontWeight: "900" },
    matchBody: { flex: 1, gap: 4 },
    matchTopline: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
    matchName: { flex: 1, color: palette.ink, fontFamily: headingFont, fontSize: 18, fontWeight: "900" },
    scorePill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 12, backgroundColor: "rgba(224,122,95,0.16)" },
    scorePillText: { color: palette.terracotta, fontFamily: bodyFont, fontSize: 13, fontWeight: "900", fontVariant: ["tabular-nums"] },
    matchMeta: { color: palette.terracotta, fontFamily: bodyFont, fontSize: 13, fontWeight: "800" },
    matchSummary: { color: "rgba(36,49,36,0.74)", fontFamily: bodyFont, fontSize: 13, fontWeight: "300", lineHeight: 18 },
    matchSkills: { color: palette.moss, fontFamily: bodyFont, fontSize: 12, fontWeight: "800" },
    emptyReveal: { padding: 18, borderRadius: 24, backgroundColor: "rgba(245,241,232,0.7)", borderWidth: 1, borderColor: "rgba(59,77,59,0.12)" },
    emptyRevealText: { color: "rgba(36,49,36,0.74)", fontFamily: bodyFont, fontSize: 14, fontWeight: "300", lineHeight: 20 },
    revealActions: { gap: 12, alignItems: "flex-start" },

    primaryButton: { overflow: "hidden", paddingHorizontal: 26, paddingVertical: 15, borderTopLeftRadius: 26, borderTopRightRadius: 10, borderBottomLeftRadius: 12, borderBottomRightRadius: 28, boxShadow: "0 16px 28px rgba(224,122,95,0.34)" },
    primaryPressed: { transform: [{ scale: 0.97 }] },
    primaryDisabled: { opacity: 0.5 },
    primaryLabel: { color: "#FFFDF7", fontFamily: headingFont, fontSize: 16, fontWeight: "900", letterSpacing: 0.3 },
    ghostLink: { paddingVertical: 4 },
    ghostLinkText: { color: palette.olive, fontFamily: bodyFont, fontSize: 14, fontWeight: "700" },
    pressed: { transform: [{ scale: 0.97 }] },

    mascotBody: { borderTopLeftRadius: 48, borderTopRightRadius: 40, borderBottomLeftRadius: 44, borderBottomRightRadius: 52, transform: [{ rotate: "-4deg" }], boxShadow: "0 14px 24px rgba(59,77,59,0.22)" },
    mascotEye: { position: "absolute", width: 12, height: 14, borderRadius: 7, backgroundColor: palette.ink },
    mascotCheek: { position: "absolute", width: 13, height: 9, borderRadius: 6, backgroundColor: "rgba(224,122,95,0.55)" },
    mascotMouth: { position: "absolute", width: 18, height: 9, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, backgroundColor: palette.ink },
    mascotMouthTalk: { position: "absolute", width: 16, height: 14, borderRadius: 8, backgroundColor: palette.ink },
    mascotSpark: { position: "absolute", width: 18, height: 18, borderTopLeftRadius: 10, borderTopRightRadius: 4, borderBottomLeftRadius: 4, borderBottomRightRadius: 10, backgroundColor: palette.terracotta, transform: [{ rotate: "18deg" }] },
    mascotSparkSmall: { width: 11, height: 11, backgroundColor: palette.sage },

    bubble: { flex: 1, backgroundColor: "rgba(255,253,247,0.92)", paddingHorizontal: 14, paddingVertical: 11, borderTopLeftRadius: 4, borderTopRightRadius: 20, borderBottomLeftRadius: 20, borderBottomRightRadius: 20, borderWidth: 1, borderColor: "rgba(59,77,59,0.12)", boxShadow: "0 10px 18px rgba(59,77,59,0.1)" },
    bubbleText: { color: palette.ink, fontFamily: bodyFont, fontSize: 14, fontWeight: "500", lineHeight: 19 },
    bubbleTail: { position: "absolute", left: -6, top: 16, width: 12, height: 12, backgroundColor: "rgba(255,253,247,0.92)", borderLeftWidth: 1, borderBottomWidth: 1, borderColor: "rgba(59,77,59,0.12)", transform: [{ rotate: "45deg" }] },

    blob: { position: "absolute", opacity: 0.4 },
    blobOne: { left: -120, top: 60, width: 260, height: 220, borderTopLeftRadius: 150, borderTopRightRadius: 90, borderBottomLeftRadius: 80, borderBottomRightRadius: 150, backgroundColor: "rgba(156,175,136,0.4)", transform: [{ rotate: "-12deg" }] },
    blobTwo: { right: -150, top: -30, width: 320, height: 240, borderTopLeftRadius: 95, borderTopRightRadius: 170, borderBottomLeftRadius: 160, borderBottomRightRadius: 80, backgroundColor: "rgba(224,122,95,0.2)", transform: [{ rotate: "10deg" }] },
    blobThree: { right: -100, bottom: 40, width: 320, height: 280, borderTopLeftRadius: 170, borderTopRightRadius: 110, borderBottomLeftRadius: 110, borderBottomRightRadius: 180, backgroundColor: "rgba(156,175,136,0.22)", transform: [{ rotate: "16deg" }] },
    noise: { ...StyleSheet.absoluteFillObject, opacity: 0.16, backgroundColor: "rgba(255,255,255,0.22)" },

    proofBand: { flex: 1, justifyContent: "center", gap: 12, minHeight: 0, marginTop: 2 },
    testimonialCard: { alignSelf: "flex-start", maxWidth: "94%", backgroundColor: "rgba(255,253,247,0.82)", paddingHorizontal: 15, paddingVertical: 12, borderTopLeftRadius: 6, borderTopRightRadius: 22, borderBottomLeftRadius: 22, borderBottomRightRadius: 22, borderWidth: 1, borderColor: "rgba(59,77,59,0.12)", boxShadow: "0 12px 22px rgba(59,77,59,0.1)", transform: [{ rotate: "-1.2deg" }] },
    stars: { color: palette.terracotta, fontSize: 13, letterSpacing: 2, marginBottom: 5 },
    testimonialQuote: { color: palette.ink, fontFamily: bodyFont, fontSize: 14, fontWeight: "500", lineHeight: 19 },
    testimonialName: { color: palette.moss, fontFamily: bodyFont, fontSize: 12, fontWeight: "800", marginTop: 4 },
    statRow: { flexDirection: "row", gap: 10 },
    statPill: { flex: 1, paddingVertical: 11, paddingHorizontal: 11, alignItems: "flex-start", borderTopLeftRadius: 20, borderTopRightRadius: 8, borderBottomLeftRadius: 8, borderBottomRightRadius: 22, borderWidth: 1 },
    statPillTerracotta: { backgroundColor: "rgba(224,122,95,0.14)", borderColor: "rgba(224,122,95,0.34)" },
    statPillOlive: { backgroundColor: "rgba(59,77,59,0.1)", borderColor: "rgba(59,77,59,0.22)" },
    statPillSage: { backgroundColor: "rgba(156,175,136,0.18)", borderColor: "rgba(156,175,136,0.4)" },
    statValue: { color: palette.olive, fontFamily: headingFont, fontSize: 22, fontWeight: "900", fontVariant: ["tabular-nums"], letterSpacing: -0.5 },
    statLabel: { color: "rgba(36,49,36,0.66)", fontFamily: bodyFont, fontSize: 11, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase", marginTop: 1 },
});
