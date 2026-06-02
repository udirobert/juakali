import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
    ActivityIndicator,
    Linking,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
    FadeIn,
    FadeInUp,
    LinearTransition,
    useAnimatedScrollHandler,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
} from "react-native-reanimated";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import type { ViewStyle } from "react-native";

import { api } from "@/convex/_generated/api";

type DashboardData = FunctionReturnType<typeof api.telephony.dashboardData>;
type MasterSummary = DashboardData["masters"][number];
type ApprenticeSummary = DashboardData["apprentices"][number];
type MatchSummary = DashboardData["recentMatches"][number];
type OutboundMessage = DashboardData["outboundMessages"][number];
type VoiceIntake = DashboardData["voiceIntakes"][number];
type CountItem = DashboardData["analytics"]["mastersByCraft"][number];
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

const endpoints = [
    { label: "Voice call entry", path: "/webhooks/voice/inbound" },
    { label: "Recording callback", path: "/webhooks/voice/recording" },
    { label: "SMS discovery", path: "/webhooks/sms/inbound" },
    { label: "USSD session", path: "/webhooks/ussd" },
];

const heroMaskStyle: WebShapeStyle = {
    clipPath: "polygon(8% 0%, 100% 10%, 91% 92%, 0% 100%)",
};

const diagonalPatchStyle: WebShapeStyle = {
    clipPath: "polygon(0 8%, 94% 0, 100% 86%, 8% 100%)",
};

const glassStyle: WebShapeStyle = {
    backdropFilter: "blur(18px)",
};

export function AdminDashboard() {
    const data = useQuery(api.telephony.dashboardData, {});
    const seedDemoData = useMutation(api.telephony.seedDemoData);
    const sendQueuedBatch = useAction(api.smsDelivery.sendQueuedBatch);
    const { width } = useWindowDimensions();
    const isWide = width >= 900;
    const reducedMotion = useReducedMotion();
    const scrollY = useSharedValue(0);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [isSeeding, setIsSeeding] = useState(false);
    const [isSending, setIsSending] = useState(false);

    const onScroll = useAnimatedScrollHandler((event) => {
        scrollY.value = event.contentOffset.y;
    });
    const driftStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: reducedMotion ? 0 : Math.min(scrollY.value * 0.05, 34) }],
    }));

    async function handleSeedDemo() {
        await softTap();
        setIsSeeding(true);
        try {
            const result = await seedDemoData({});
            setStatusMessage(`${result.message}: ${result.createdMasters} masters, ${result.createdMatches} matches.`);
        } catch (error) {
            setStatusMessage(error instanceof Error ? error.message : "Could not seed demo data.");
        } finally {
            setIsSeeding(false);
        }
    }

    async function handleSendQueued() {
        await softTap();
        setIsSending(true);
        try {
            const result = await sendQueuedBatch({ limit: 10 });
            setStatusMessage(`SMS delivery attempted ${result.attempted}; sent ${result.sent}, failed ${result.failed}.`);
        } catch (error) {
            setStatusMessage(error instanceof Error ? error.message : "Could not send queued SMS.");
        } finally {
            setIsSending(false);
        }
    }

    if (data === undefined) {
        return (
            <View style={styles.loadingScreen}>
                <OrganicBackground />
                <ActivityIndicator color={palette.olive} />
                <Text style={styles.loadingText}>Preparing voice, SMS, and USSD flows…</Text>
            </View>
        );
    }

    return (
        <View style={styles.screen}>
            <OrganicBackground />
            <Animated.View pointerEvents="none" style={[styles.scrollBlob, driftStyle]} />
            <Animated.ScrollView
                contentContainerStyle={styles.content}
                contentInsetAdjustmentBehavior="automatic"
                onScroll={onScroll}
                scrollEventThrottle={16}
            >
                <Animated.View entering={reducedMotion ? undefined : FadeIn.duration(260)} style={[styles.hero, isWide && styles.heroWide]}>
                    <View style={styles.heroCopy}>
                        <Text style={styles.eyebrow}>Voice · SMS · USSD portal</Text>
                        <Text accessibilityRole="header" style={[styles.title, isWide && styles.titleWide]}>
                            Jua Kali apprenticeship matcher
                        </Text>
                        <Text style={styles.subtitle}>
                            A phone-first operating surface for matching Kenyan master artisans with youth seeking practical skills.
                        </Text>
                        <View style={styles.actionsRow}>
                            <OrganicButton label="Seed demo village" onPress={handleSeedDemo} disabled={isSeeding} tone="terracotta" />
                            <OrganicButton label="Send queued SMS" onPress={handleSendQueued} disabled={isSending} tone="olive" />
                        </View>
                        {statusMessage ? <Text style={styles.statusLine}>{statusMessage}</Text> : null}
                    </View>

                    <LinearGradient
                        colors={["rgba(156,175,136,0.95)", "rgba(224,122,95,0.82)", "rgba(59,77,59,0.92)"]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={[styles.heroFigure, heroMaskStyle]}
                    >
                        <View style={styles.figureNoise} />
                        <Text style={styles.figureNumber}>{data.analytics.totalMasters}</Text>
                        <Text style={styles.figureLabel}>Masters captured from voice intake</Text>
                        <Text style={styles.figurePullQuote}>“Naitwa Asha — I teach welding, safety, finishing.”</Text>
                    </LinearGradient>
                </Animated.View>

                <WaveDivider />

                <Animated.View layout={LinearTransition.duration(220)} style={[styles.metricsFlow, isWide && styles.metricsFlowWide]}>
                    <MetricShard label="Registered Masters" value={data.analytics.totalMasters} rotate="-4deg" />
                    <MetricShard label="Apprentices" value={data.analytics.totalApprentices} rotate="3deg" />
                    <MetricShard label="Proposed Matches" value={data.analytics.totalMatches} rotate="-2deg" />
                    <MetricShard label="Queued SMS" value={data.analytics.queuedSms} rotate="5deg" />
                </Animated.View>

                <View style={[styles.diagonalBand, isWide && styles.diagonalBandWide]}>
                    <OrganicSection title="Provider paths" subtitle="Point Twilio or Africa's Talking to these Convex HTTP endpoints.">
                        {endpoints.map((endpoint, index) => (
                            <EndpointStrand key={endpoint.path} endpoint={endpoint} index={index} />
                        ))}
                    </OrganicSection>
                    <OrganicSection title="Voice intake queue" subtitle="Recording callbacks become structured Master profiles after ASR + extraction.">
                        {data.voiceIntakes.length === 0 ? (
                            <EmptyPatch title="No voice callbacks yet" body="Use the recording webhook with RecordingUrl or transcript text to create the first intake." />
                        ) : (
                            data.voiceIntakes.map((intake, index) => <VoiceStrand key={intake.id} intake={intake} index={index} />)
                        )}
                    </OrganicSection>
                </View>

                <View style={[styles.overlapFlow, isWide && styles.overlapFlowWide]}>
                    <OrganicSection title="Masters" subtitle="Artisan profiles transcribed from voice and ready for matching.">
                        {data.masters.length === 0 ? (
                            <EmptyPatch title="No Masters yet" body="Seed demo data or post a voice recording callback to populate this surface." />
                        ) : (
                            data.masters.map((master, index) => <MasterPatch key={master.id} master={master} index={index} />)
                        )}
                    </OrganicSection>

                    <OrganicSection title="Apprentices" subtitle="Youth entering discovery by SMS keyword or USSD menu.">
                        {data.apprentices.length === 0 ? (
                            <EmptyPatch title="No Apprentices yet" body="Send CHUKUA by SMS or complete a USSD text path to create discovery records." />
                        ) : (
                            data.apprentices.map((apprentice, index) => <ApprenticeStrand key={apprentice.id} apprentice={apprentice} index={index} />)
                        )}
                    </OrganicSection>
                </View>

                <View style={[styles.overlapFlow, isWide && styles.overlapFlowWide]}>
                    <OrganicSection title="Successful matches" subtitle="Top proposed Master–Apprentice connections with match confidence.">
                        {data.recentMatches.length === 0 ? (
                            <EmptyPatch title="No matches yet" body="Complete SMS or USSD discovery to generate the first proposed match." />
                        ) : (
                            data.recentMatches.map((match, index) => <MatchStrand key={match.id} match={match} index={index} />)
                        )}
                    </OrganicSection>

                    <OrganicSection title="SMS outbox" subtitle="Provider-ready outbound messages from automated matching.">
                        {data.outboundMessages.length === 0 ? (
                            <EmptyPatch title="No outbound SMS yet" body="Replies and Master alerts will land here before delivery." />
                        ) : (
                            data.outboundMessages.map((message, index) => <OutboundStrand key={message.id} message={message} index={index} />)
                        )}
                    </OrganicSection>
                </View>

                <View style={[styles.analyticsFlow, isWide && styles.analyticsFlowWide]}>
                    <AnalyticsPatch title="Masters by craft" items={data.analytics.mastersByCraft} />
                    <AnalyticsPatch title="Apprentices by craft" items={data.analytics.apprenticesByCraft} />
                    <AnalyticsPatch title="Geographic heat" items={data.analytics.signupsByLocation} />
                </View>
            </Animated.ScrollView>
        </View>
    );
}

function OrganicBackground() {
    return (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <LinearGradient colors={[palette.cream, "#EFE2D1", "#DCE5D2"]} style={StyleSheet.absoluteFill} />
            <View style={[styles.backgroundBlob, styles.backgroundBlobOne]} />
            <View style={[styles.backgroundBlob, styles.backgroundBlobTwo]} />
            <View style={[styles.backgroundBlob, styles.backgroundBlobThree]} />
            <View style={[styles.backgroundWave, styles.backgroundWaveOne]} />
            <View style={[styles.backgroundWave, styles.backgroundWaveTwo]} />
            <View style={styles.noiseOverlay} />
        </View>
    );
}

function WaveDivider() {
    return (
        <View style={styles.wave}>
            <View style={[styles.waveLobe, styles.waveLobeOne]} />
            <View style={[styles.waveLobe, styles.waveLobeTwo]} />
            <View style={[styles.waveLobe, styles.waveLobeThree]} />
            <View style={styles.waveStroke} />
        </View>
    );
}

function OrganicButton({ label, onPress, disabled, tone }: { label: string; onPress: () => void; disabled: boolean; tone: "terracotta" | "olive" }) {
    return (
        <Pressable
            accessibilityRole="button"
            disabled={disabled}
            onPress={onPress}
            style={({ pressed }) => [
                styles.organicButton,
                tone === "terracotta" ? styles.terracottaButton : styles.oliveButton,
                pressed && styles.buttonPressed,
                disabled && styles.buttonDisabled,
            ]}
        >
            <Text style={styles.organicButtonText}>{disabled ? "Working…" : label}</Text>
        </Pressable>
    );
}

function MetricShard({ label, value, rotate }: { label: string; value: number; rotate: string }) {
    return (
        <Animated.View entering={FadeInUp.duration(260)} style={[styles.metricShard, { transform: [{ rotate }] }, diagonalPatchStyle]}>
            <Text style={styles.metricValue}>{value}</Text>
            <Text style={styles.metricLabel}>{label}</Text>
        </Animated.View>
    );
}

function OrganicSection({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
    return (
        <Animated.View entering={FadeInUp.duration(240)} style={[styles.organicSection, glassStyle]}>
            <View style={styles.sectionHeader}>
                <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
                <Text style={styles.sectionSubtitle}>{subtitle}</Text>
            </View>
            <View style={styles.strandList}>{children}</View>
        </Animated.View>
    );
}

function EndpointStrand({ endpoint, index }: { endpoint: { label: string; path: string }; index: number }) {
    return (
        <View style={[styles.endpointStrand, index % 2 === 1 && styles.strandOffset]}>
            <Text style={styles.endpointLabel}>{endpoint.label}</Text>
            <Text selectable style={styles.endpointPath}>{endpoint.path}</Text>
        </View>
    );
}

function VoiceStrand({ intake, index }: { intake: VoiceIntake; index: number }) {
    return (
        <View style={[styles.strand, index % 2 === 1 && styles.strandOffset]}>
            <View style={styles.strandTopline}>
                <Text selectable style={styles.rowTitle}>{intake.extractedName ?? intake.fromPhone ?? "Unknown caller"}</Text>
                <StatusInk label={intake.processingStatus} />
            </View>
            <Text style={styles.rowMeta}>{intake.extractedCraftText ?? "Craft pending"} · {intake.extractedLocationText ?? "Location pending"}</Text>
            {intake.transcript ? <Text style={styles.bodyText}>{intake.transcript.slice(0, 180)}</Text> : null}
            {intake.errorMessage ? <Text style={styles.errorText}>{intake.errorMessage}</Text> : null}
            {intake.recordingUrl ? <AudioLink url={intake.recordingUrl} /> : null}
        </View>
    );
}

function MasterPatch({ master, index }: { master: MasterSummary; index: number }) {
    const skills = master.keySkills.length > 0 ? master.keySkills.join(" · ") : "Skills pending review";
    return (
        <View style={[styles.masterPatch, index % 2 === 1 && styles.strandOffset]}>
            <View style={styles.strandTopline}>
                <Text style={styles.patchTitle}>{master.name}</Text>
                <StatusInk label={master.status.replace("_", " ")} />
            </View>
            <Text style={styles.patchMeta}>{master.craftText} from {master.locationText}</Text>
            <Text style={styles.bodyText}>{master.profileSummary}</Text>
            <Text style={styles.skillText}>{skills}</Text>
            <View style={styles.actionLine}>
                <Text selectable style={styles.phoneText}>{master.phoneNumber ?? "Phone pending"}</Text>
                {master.originalAudioUrl ? <AudioLink url={master.originalAudioUrl} /> : null}
            </View>
        </View>
    );
}

function ApprenticeStrand({ apprentice, index }: { apprentice: ApprenticeSummary; index: number }) {
    return (
        <View style={[styles.strand, index % 2 === 1 && styles.strandOffset]}>
            <View style={styles.strandTopline}>
                <Text selectable style={styles.rowTitle}>{apprentice.phoneNumber}</Text>
                <StatusInk label={apprentice.status} />
            </View>
            <Text style={styles.rowMeta}>{apprentice.desiredCraft} · {apprentice.locationText} · {apprentice.channel.toUpperCase()}</Text>
        </View>
    );
}

function MatchStrand({ match, index }: { match: MatchSummary; index: number }) {
    return (
        <View style={[styles.strand, index % 2 === 1 && styles.strandOffset]}>
            <View style={styles.strandTopline}>
                <Text style={styles.rowTitle}>{match.masterName}</Text>
                <Text style={styles.score}>{match.score}</Text>
            </View>
            <Text selectable style={styles.rowMeta}>{match.apprenticePhone} · {match.craftText} · {match.locationText}</Text>
        </View>
    );
}

function OutboundStrand({ message, index }: { message: OutboundMessage; index: number }) {
    return (
        <View style={[styles.strand, index % 2 === 1 && styles.strandOffset]}>
            <View style={styles.strandTopline}>
                <Text selectable style={styles.rowTitle}>{message.recipientPhone}</Text>
                <StatusInk label={message.providerStatus} />
            </View>
            <Text style={styles.bodyText}>{message.body}</Text>
        </View>
    );
}

function AnalyticsPatch({ title, items }: { title: string; items: Array<CountItem> }) {
    const max = useMemo(() => Math.max(1, ...items.map((item) => item.count)), [items]);
    return (
        <OrganicSection title={title} subtitle="Live distribution from recent records.">
            {items.length === 0 ? (
                <EmptyPatch title="No signal yet" body="Counts grow as intake and discovery activity arrives." />
            ) : (
                items.map((item, index) => (
                    <View key={item.label} style={[styles.barStrand, index % 2 === 1 && styles.strandOffset]}>
                        <View style={styles.barLabelRow}>
                            <Text style={styles.barLabel}>{item.label}</Text>
                            <Text style={styles.barCount}>{item.count}</Text>
                        </View>
                        <View style={styles.barTrack}>
                            <LinearGradient
                                colors={[palette.sage, palette.terracotta]}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 0 }}
                                style={[styles.barFill, { width: `${Math.max(14, (item.count / max) * 100)}%` }]}
                            />
                        </View>
                    </View>
                ))
            )}
        </OrganicSection>
    );
}

function EmptyPatch({ title, body }: { title: string; body: string }) {
    return (
        <View style={styles.emptyPatch}>
            <View style={styles.emptyGlyph} />
            <Text style={styles.emptyTitle}>{title}</Text>
            <Text style={styles.emptyBody}>{body}</Text>
        </View>
    );
}

function StatusInk({ label }: { label: string }) {
    return (
        <View style={styles.statusInk}>
            <Text style={styles.statusText}>{label}</Text>
        </View>
    );
}

function AudioLink({ url }: { url: string }) {
    return (
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(url)} style={({ pressed }) => [styles.audioLink, pressed && styles.buttonPressed]}>
            <Text style={styles.audioText}>Open audio</Text>
        </Pressable>
    );
}

async function softTap(): Promise<void> {
    if (Platform.OS === "web") return;
    await Haptics.selectionAsync();
}

const styles = StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: palette.cream,
    },
    loadingScreen: {
        flex: 1,
        alignItems: "flex-start",
        justifyContent: "center",
        gap: 14,
        paddingHorizontal: 28,
    },
    loadingText: {
        color: palette.olive,
        fontFamily: Platform.select({ web: "Inter, Avenir, system-ui, sans-serif", default: "System" }),
        fontSize: 16,
        fontWeight: "300",
    },
    noiseOverlay: {
        ...StyleSheet.absoluteFillObject,
        opacity: 0.18,
        backgroundColor: "rgba(255,255,255,0.22)",
    },
    backgroundBlob: {
        position: "absolute",
        opacity: 0.42,
    },
    backgroundBlobOne: {
        left: -110,
        top: 38,
        width: 260,
        height: 210,
        borderTopLeftRadius: 140,
        borderTopRightRadius: 90,
        borderBottomLeftRadius: 70,
        borderBottomRightRadius: 150,
        backgroundColor: "rgba(156,175,136,0.42)",
        transform: [{ rotate: "-14deg" }],
    },
    backgroundBlobTwo: {
        right: -160,
        top: -36,
        width: 330,
        height: 250,
        borderTopLeftRadius: 95,
        borderTopRightRadius: 175,
        borderBottomLeftRadius: 160,
        borderBottomRightRadius: 80,
        backgroundColor: "rgba(224,122,95,0.24)",
        transform: [{ rotate: "9deg" }],
    },
    backgroundBlobThree: {
        right: -120,
        bottom: 80,
        width: 340,
        height: 290,
        borderTopLeftRadius: 170,
        borderTopRightRadius: 115,
        borderBottomLeftRadius: 110,
        borderBottomRightRadius: 180,
        backgroundColor: "rgba(156,175,136,0.24)",
        transform: [{ rotate: "18deg" }],
    },
    backgroundWave: {
        position: "absolute",
        width: "120%",
        height: 160,
        left: "-10%",
        borderTopLeftRadius: 180,
        borderTopRightRadius: 80,
        borderBottomLeftRadius: 60,
        borderBottomRightRadius: 160,
        opacity: 0.08,
    },
    backgroundWaveOne: {
        top: 470,
        backgroundColor: palette.olive,
        transform: [{ rotate: "-5deg" }],
    },
    backgroundWaveTwo: {
        top: 560,
        backgroundColor: palette.terracotta,
        transform: [{ rotate: "6deg" }],
    },
    scrollBlob: {
        position: "absolute",
        right: -80,
        top: 320,
        width: 220,
        height: 180,
        borderTopLeftRadius: 120,
        borderTopRightRadius: 80,
        borderBottomLeftRadius: 70,
        borderBottomRightRadius: 130,
        backgroundColor: "rgba(224,122,95,0.18)",
    },
    content: {
        gap: 22,
        paddingHorizontal: 18,
        paddingTop: 22,
        paddingBottom: 56,
        width: "100%",
        maxWidth: 1180,
        alignSelf: "center",
    },
    hero: {
        gap: 20,
        minHeight: 430,
        paddingTop: 34,
    },
    heroWide: {
        flexDirection: "row",
        alignItems: "center",
        gap: 44,
        minHeight: 470,
    },
    heroCopy: {
        flex: 1.1,
        gap: 15,
        alignItems: "flex-start",
        zIndex: 2,
    },
    eyebrow: {
        color: palette.terracotta,
        fontFamily: Platform.select({ web: "Inter, Avenir, system-ui, sans-serif", default: "System" }),
        fontSize: 12,
        fontWeight: "300",
        letterSpacing: 1.8,
        marginLeft: 8,
        textTransform: "uppercase",
    },
    title: {
        color: palette.olive,
        fontFamily: Platform.select({ web: "Equipment, Inter, Avenir Next, system-ui, sans-serif", default: "System" }),
        fontSize: 54,
        fontWeight: "800",
        letterSpacing: -2.8,
        lineHeight: 56,
        marginLeft: -32,
        maxWidth: 620,
    },
    titleWide: {
        fontSize: 82,
        lineHeight: 80,
        marginLeft: -72,
    },
    subtitle: {
        color: palette.ink,
        fontFamily: Platform.select({ web: "Inter, Avenir, system-ui, sans-serif", default: "System" }),
        fontSize: 17,
        fontWeight: "300",
        lineHeight: 27,
        maxWidth: 520,
        marginLeft: 8,
    },
    actionsRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 12,
        marginLeft: 4,
        marginTop: 8,
    },
    organicButton: {
        paddingHorizontal: 18,
        paddingVertical: 13,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 8,
        borderBottomLeftRadius: 10,
        borderBottomRightRadius: 24,
        boxShadow: "0 16px 28px rgba(59, 77, 59, 0.24)",
    },
    terracottaButton: {
        backgroundColor: palette.terracotta,
    },
    oliveButton: {
        backgroundColor: palette.olive,
    },
    buttonPressed: {
        transform: [{ scale: 0.97 }, { rotate: "-1deg" }],
    },
    buttonDisabled: {
        opacity: 0.64,
    },
    organicButtonText: {
        color: "#FFFDF7",
        fontSize: 13,
        fontWeight: "800",
        letterSpacing: 0.2,
    },
    statusLine: {
        color: palette.olive,
        fontSize: 13,
        fontWeight: "700",
        marginLeft: 8,
        maxWidth: 560,
    },
    heroFigure: {
        flex: 0.9,
        minHeight: 300,
        justifyContent: "flex-end",
        overflow: "hidden",
        padding: 24,
        boxShadow: "0 28px 48px rgba(59, 77, 59, 0.32)",
        transform: [{ rotate: "3deg" }, { translateY: 18 }],
    },
    figureNoise: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "rgba(255,255,255,0.12)",
    },
    figureNumber: {
        color: "#FFFDF7",
        fontSize: 78,
        fontWeight: "900",
        fontVariant: ["tabular-nums"],
        letterSpacing: -4,
    },
    figureLabel: {
        color: "rgba(255,253,247,0.82)",
        fontSize: 14,
        fontWeight: "800",
        letterSpacing: 0.4,
        textTransform: "uppercase",
    },
    figurePullQuote: {
        color: "#FFFDF7",
        fontSize: 21,
        fontWeight: "300",
        lineHeight: 29,
        marginTop: 22,
        marginRight: -12,
    },
    wave: {
        height: 74,
        marginTop: -10,
        overflow: "hidden",
        transform: [{ rotate: "-1.5deg" }],
    },
    waveLobe: {
        position: "absolute",
        top: 24,
        height: 72,
        borderTopLeftRadius: 90,
        borderTopRightRadius: 30,
        borderBottomLeftRadius: 24,
        borderBottomRightRadius: 90,
        backgroundColor: "rgba(59,77,59,0.13)",
    },
    waveLobeOne: {
        left: -28,
        width: "42%",
        transform: [{ rotate: "3deg" }],
    },
    waveLobeTwo: {
        left: "30%",
        width: "46%",
        backgroundColor: "rgba(224,122,95,0.12)",
        transform: [{ rotate: "-5deg" }],
    },
    waveLobeThree: {
        right: -38,
        width: "40%",
        transform: [{ rotate: "5deg" }],
    },
    waveStroke: {
        position: "absolute",
        left: "8%",
        right: "8%",
        top: 42,
        height: 3,
        backgroundColor: "rgba(224,122,95,0.55)",
        transform: [{ rotate: "-2deg" }],
    },
    metricsFlow: {
        gap: 14,
        marginTop: -20,
    },
    metricsFlowWide: {
        flexDirection: "row",
        alignItems: "flex-start",
        marginTop: -36,
    },
    metricShard: {
        flex: 1,
        minHeight: 118,
        justifyContent: "center",
        padding: 20,
        backgroundColor: "rgba(245, 241, 232, 0.76)",
        borderWidth: 1,
        borderColor: "rgba(59, 77, 59, 0.18)",
        boxShadow: "0 22px 34px rgba(59, 77, 59, 0.18)",
    },
    metricValue: {
        color: palette.olive,
        fontSize: 42,
        fontWeight: "900",
        fontVariant: ["tabular-nums"],
    },
    metricLabel: {
        color: palette.ink,
        fontSize: 12,
        fontWeight: "300",
        letterSpacing: 1.2,
        textTransform: "uppercase",
    },
    diagonalBand: {
        gap: 18,
        transform: [{ rotate: "-1deg" }],
    },
    diagonalBandWide: {
        flexDirection: "row",
        alignItems: "flex-start",
    },
    overlapFlow: {
        gap: 18,
    },
    overlapFlowWide: {
        flexDirection: "row",
        alignItems: "flex-start",
    },
    analyticsFlow: {
        gap: 18,
        transform: [{ rotate: "1deg" }],
    },
    analyticsFlowWide: {
        flexDirection: "row",
        alignItems: "flex-start",
    },
    organicSection: {
        flex: 1,
        gap: 15,
        padding: 18,
        backgroundColor: "rgba(255, 253, 247, 0.66)",
        borderTopLeftRadius: 42,
        borderTopRightRadius: 14,
        borderBottomLeftRadius: 18,
        borderBottomRightRadius: 52,
        borderWidth: 1,
        borderColor: "rgba(59, 77, 59, 0.13)",
        boxShadow: "0 24px 42px rgba(59, 77, 59, 0.16)",
    },
    sectionHeader: {
        gap: 5,
        marginLeft: -8,
    },
    sectionTitle: {
        color: palette.olive,
        fontSize: 27,
        fontWeight: "800",
        letterSpacing: -0.9,
    },
    sectionSubtitle: {
        color: "rgba(36,49,36,0.72)",
        fontSize: 14,
        fontWeight: "300",
        lineHeight: 21,
        maxWidth: 460,
    },
    strandList: {
        gap: 12,
    },
    endpointStrand: {
        gap: 4,
        paddingVertical: 12,
        paddingHorizontal: 14,
        backgroundColor: "rgba(156,175,136,0.16)",
        borderLeftWidth: 4,
        borderLeftColor: palette.terracotta,
        transform: [{ rotate: "-0.6deg" }],
    },
    strand: {
        gap: 7,
        paddingVertical: 13,
        paddingHorizontal: 14,
        backgroundColor: "rgba(245, 241, 232, 0.74)",
        borderLeftWidth: 3,
        borderLeftColor: palette.sage,
        boxShadow: "0 14px 24px rgba(59,77,59,0.10)",
    },
    strandOffset: {
        marginLeft: "8%",
        transform: [{ rotate: "1.2deg" }],
    },
    masterPatch: {
        gap: 8,
        padding: 15,
        backgroundColor: "rgba(245, 241, 232, 0.86)",
        borderTopLeftRadius: 32,
        borderTopRightRadius: 10,
        borderBottomLeftRadius: 12,
        borderBottomRightRadius: 38,
        borderWidth: 1,
        borderColor: "rgba(59, 77, 59, 0.12)",
        boxShadow: "0 18px 30px rgba(59,77,59,0.13)",
    },
    strandTopline: {
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
    },
    endpointLabel: {
        color: palette.terracotta,
        fontSize: 11,
        fontWeight: "900",
        letterSpacing: 1,
        textTransform: "uppercase",
    },
    endpointPath: {
        color: palette.olive,
        fontSize: 14,
        fontWeight: "800",
    },
    patchTitle: {
        flex: 1,
        color: palette.ink,
        fontSize: 19,
        fontWeight: "900",
        letterSpacing: -0.4,
    },
    patchMeta: {
        color: palette.terracotta,
        fontSize: 14,
        fontWeight: "800",
    },
    rowTitle: {
        flex: 1,
        color: palette.ink,
        fontSize: 15,
        fontWeight: "900",
    },
    rowMeta: {
        color: "rgba(36,49,36,0.68)",
        fontSize: 13,
        lineHeight: 18,
    },
    bodyText: {
        color: "rgba(36,49,36,0.78)",
        fontSize: 13,
        fontWeight: "300",
        lineHeight: 20,
    },
    errorText: {
        color: palette.terracotta,
        fontSize: 13,
        fontWeight: "700",
        lineHeight: 19,
    },
    skillText: {
        color: palette.moss,
        fontSize: 12,
        fontWeight: "800",
        letterSpacing: 0.2,
    },
    actionLine: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
    phoneText: {
        color: palette.ink,
        fontSize: 13,
        fontWeight: "900",
    },
    audioLink: {
        paddingHorizontal: 12,
        paddingVertical: 7,
        backgroundColor: "rgba(224,122,95,0.16)",
        borderTopLeftRadius: 16,
        borderBottomRightRadius: 16,
    },
    audioText: {
        color: palette.terracotta,
        fontSize: 12,
        fontWeight: "900",
    },
    statusInk: {
        paddingHorizontal: 9,
        paddingVertical: 5,
        backgroundColor: "rgba(156,175,136,0.18)",
        borderTopLeftRadius: 14,
        borderBottomRightRadius: 14,
        borderWidth: 1,
        borderColor: "rgba(59,77,59,0.14)",
    },
    statusText: {
        color: palette.olive,
        fontSize: 10,
        fontWeight: "900",
        letterSpacing: 0.5,
        textTransform: "uppercase",
    },
    score: {
        color: palette.terracotta,
        fontSize: 19,
        fontWeight: "900",
        fontVariant: ["tabular-nums"],
    },
    emptyPatch: {
        alignItems: "flex-start",
        gap: 8,
        padding: 18,
        backgroundColor: "rgba(245, 241, 232, 0.58)",
        borderTopLeftRadius: 34,
        borderTopRightRadius: 8,
        borderBottomLeftRadius: 12,
        borderBottomRightRadius: 34,
        borderWidth: 1,
        borderColor: "rgba(59,77,59,0.12)",
    },
    emptyGlyph: {
        width: 38,
        height: 31,
        borderTopLeftRadius: 22,
        borderTopRightRadius: 12,
        borderBottomLeftRadius: 8,
        borderBottomRightRadius: 20,
        backgroundColor: "rgba(224,122,95,0.26)",
        transform: [{ rotate: "-8deg" }],
    },
    emptyTitle: {
        color: palette.ink,
        fontSize: 16,
        fontWeight: "900",
    },
    emptyBody: {
        color: "rgba(36,49,36,0.66)",
        fontSize: 13,
        fontWeight: "300",
        lineHeight: 19,
    },
    barStrand: {
        gap: 8,
        padding: 10,
        backgroundColor: "rgba(245, 241, 232, 0.66)",
    },
    barLabelRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        gap: 12,
    },
    barLabel: {
        flex: 1,
        color: palette.ink,
        fontSize: 14,
        fontWeight: "800",
    },
    barCount: {
        color: palette.terracotta,
        fontSize: 14,
        fontWeight: "900",
        fontVariant: ["tabular-nums"],
    },
    barTrack: {
        height: 11,
        overflow: "hidden",
        backgroundColor: "rgba(59,77,59,0.12)",
        borderTopLeftRadius: 12,
        borderBottomRightRadius: 12,
    },
    barFill: {
        height: "100%",
        borderTopLeftRadius: 12,
        borderBottomRightRadius: 12,
    },
});
