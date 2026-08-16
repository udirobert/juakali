import { useCallback, useRef, useState } from "react";
import {
    ActivityIndicator,
    FlatList,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated from "react-native-reanimated";

import { SunMark } from "@/components/jua-kali/sun-mark";
import { color, font, layout } from "@/components/jua-kali/theme";
import { useUiMotion } from "@/components/jua-kali/hooks/use-ui-motion";

const AGENT_URL = process.env.EXPO_PUBLIC_AGENT_URL ?? "http://localhost:8080";

interface ChatMessage {
    id: string;
    role: "user" | "agent";
    text: string;
    timestamp: number;
}

/** Short labels only — full prompt sent on press. */
const chips: Array<{ label: string; prompt: string }> = [
    { label: "Seed", prompt: "Seed the invest demo data" },
    { label: "KPIs", prompt: "List active ventures and their KPI progress" },
    { label: "Digest", prompt: "Draft an investor digest for Amina with recommendations" },
];

export function AgentChat() {
    const insets = useSafeAreaInsets();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [inputText, setInputText] = useState("");
    const [isSending, setIsSending] = useState(false);
    const listRef = useRef<FlatList>(null);
    const { fade } = useUiMotion();

    const sendMessage = useCallback(
        async (text: string) => {
            const trimmed = text.trim();
            if (!trimmed || isSending) return;

            const userMessage: ChatMessage = {
                id: `user-${Date.now()}`,
                role: "user",
                text: trimmed,
                timestamp: Date.now(),
            };

            setMessages((prev) => [...prev, userMessage]);
            setInputText("");
            setIsSending(true);

            try {
                const response = await fetch(`${AGENT_URL}/webhooks/voice/agent`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ message: trimmed }),
                });

                const data = (await response.json()) as { reply?: string; error?: string };
                setMessages((prev) => [
                    ...prev,
                    {
                        id: `agent-${Date.now()}`,
                        role: "agent",
                        text: data.reply ?? data.error ?? "No response.",
                        timestamp: Date.now(),
                    },
                ]);
            } catch (error) {
                setMessages((prev) => [
                    ...prev,
                    {
                        id: `error-${Date.now()}`,
                        role: "agent",
                        text: error instanceof Error ? error.message : "Agent unreachable.",
                        timestamp: Date.now(),
                    },
                ]);
            } finally {
                setIsSending(false);
            }
        },
        [isSending]
    );

    return (
        <KeyboardAvoidingView
            style={[styles.screen, { paddingTop: insets.top }]}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
        >
            <View style={styles.header}>
                <SunMark size={24} />
                <View style={styles.headerText}>
                    <Text style={styles.title}>Jua</Text>
                    <Text style={styles.subtitle}>Operating agent · warm, direct, fiduciary</Text>
                </View>
            </View>

            {messages.length === 0 ? (
                <View style={styles.empty}>
                    <Text style={styles.emptyIntro}>
                        Ask Jua to seed the demo, check KPIs, or draft an investor digest.
                    </Text>
                    <View style={styles.chipRow}>
                        {chips.map((chip) => (
                            <Pressable
                                key={chip.label}
                                onPress={() => void sendMessage(chip.prompt)}
                                style={styles.chip}
                            >
                                <Text style={styles.chipText}>{chip.label}</Text>
                            </Pressable>
                        ))}
                    </View>
                </View>
            ) : (
                <FlatList
                    ref={listRef}
                    data={messages}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={styles.list}
                    onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
                    renderItem={({ item }) => {
                        const agent = item.role === "agent";
                        return (
                            <Animated.View
                                entering={fade(160)}
                                style={[styles.row, agent && styles.rowAgent]}
                            >
                                <View style={[styles.bubble, agent ? styles.bubbleAgent : styles.bubbleUser]}>
                                    <Text style={[styles.bubbleText, agent && styles.bubbleTextAgent]}>
                                        {item.text}
                                    </Text>
                                </View>
                            </Animated.View>
                        );
                    }}
                />
            )}

            <View style={[styles.inputRow, { paddingBottom: Math.max(insets.bottom, 8) }]}>
                <TextInput
                    value={inputText}
                    onChangeText={setInputText}
                    placeholder="Message…"
                    placeholderTextColor={color.mist}
                    style={styles.input}
                    multiline
                    editable={!isSending}
                    onSubmitEditing={() => void sendMessage(inputText)}
                />
                <Pressable
                    onPress={() => void sendMessage(inputText)}
                    disabled={isSending || !inputText.trim()}
                    style={[styles.send, (isSending || !inputText.trim()) && styles.sendOff]}
                >
                    {isSending ? (
                        <ActivityIndicator color={color.paper} size="small" />
                    ) : (
                        <Text style={styles.sendText}>Send</Text>
                    )}
                </Pressable>
            </View>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.stone, maxWidth: layout.maxWidth, width: "100%", alignSelf: "center" },
    header: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom: 6,
    },
    headerText: { gap: 1 },
    title: {
        fontFamily: font.display,
        fontSize: 24,
        fontWeight: "700",
        letterSpacing: -0.6,
        color: color.charcoal,
    },
    subtitle: { fontFamily: font.bodyMedium, fontSize: 11, color: color.mist },
    empty: { flex: 1, justifyContent: "center", paddingHorizontal: 20, gap: 16 },
    emptyIntro: {
        fontFamily: font.body,
        fontSize: 14,
        lineHeight: 20,
        color: color.ink,
        textAlign: "center",
        maxWidth: 320,
        alignSelf: "center",
    },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" },
    chip: {
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 4,
        backgroundColor: color.paper,
        borderWidth: 1,
        borderColor: color.line,
    },
    chipText: { fontFamily: font.bodyBold, fontSize: 13, fontWeight: "700", color: color.charcoal },
    list: { paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
    row: { alignItems: "flex-end" },
    rowAgent: { alignItems: "flex-start" },
    bubble: { maxWidth: "82%", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 6 },
    bubbleUser: { backgroundColor: color.charcoal },
    bubbleAgent: {
        backgroundColor: color.paper,
        borderWidth: 1,
        borderColor: color.line,
    },
    bubbleText: { fontFamily: font.body, color: color.paper, fontSize: 14, lineHeight: 20 },
    bubbleTextAgent: { color: color.ink },
    inputRow: {
        flexDirection: "row",
        alignItems: "flex-end",
        paddingHorizontal: 12,
        paddingTop: 8,
        gap: 8,
        borderTopWidth: 1,
        borderTopColor: color.line,
        backgroundColor: color.paper,
    },
    input: {
        flex: 1,
        minHeight: 42,
        maxHeight: 100,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 4,
        backgroundColor: color.stone,
        borderWidth: 1,
        borderColor: color.lineStrong,
        color: color.ink,
        fontFamily: font.body,
        fontSize: 14,
    },
    send: {
        paddingHorizontal: 16,
        paddingVertical: 11,
        borderRadius: 4,
        backgroundColor: color.charcoal,
        minWidth: 64,
        alignItems: "center",
    },
    sendOff: { opacity: 0.45 },
    sendText: { fontFamily: font.bodyBold, color: color.paper, fontSize: 13, fontWeight: "700" },
});
