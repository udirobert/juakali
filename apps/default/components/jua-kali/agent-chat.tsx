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
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeIn } from "react-native-reanimated";

const palette = {
    sage: "#9CAF88",
    terracotta: "#E07A5F",
    cream: "#F5F1E8",
    olive: "#3B4D3B",
    ink: "#243124",
    moss: "#71845F",
};

const AGENT_URL = process.env.EXPO_PUBLIC_AGENT_URL ?? "http://localhost:8080";

interface ChatMessage {
    id: string;
    role: "user" | "agent";
    text: string;
    timestamp: number;
}

const quickPrompts = [
    "Register a welding master named John Ochieng from Kisumu who teaches arc welding, safety, and metalwork",
    "Find carpentry masters near Kariobangi for an apprentice",
    "What's the current system status?",
    "Seed demo data for testing",
];

export function AgentChat() {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [inputText, setInputText] = useState("");
    const [isSending, setIsSending] = useState(false);
    const listRef = useRef<FlatList>(null);

    const sendMessage = useCallback(async (text: string) => {
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
            const agentMessage: ChatMessage = {
                id: `agent-${Date.now()}`,
                role: "agent",
                text: data.reply ?? data.error ?? "No response from agent.",
                timestamp: Date.now(),
            };

            setMessages((prev) => [...prev, agentMessage]);
        } catch (error) {
            const errorMessage: ChatMessage = {
                id: `error-${Date.now()}`,
                role: "agent",
                text: `Connection error: ${error instanceof Error ? error.message : "Could not reach agent service."}`,
                timestamp: Date.now(),
            };
            setMessages((prev) => [...prev, errorMessage]);
        } finally {
            setIsSending(false);
        }
    }, [isSending]);

    function renderMessage({ item }: { item: ChatMessage }) {
        const isAgent = item.role === "agent";
        return (
            <Animated.View entering={FadeIn.duration(200)} style={[styles.messageRow, isAgent && styles.agentRow]}>
                <View style={[styles.bubble, isAgent ? styles.agentBubble : styles.userBubble]}>
                    <Text style={[styles.bubbleText, isAgent && styles.agentText]}>{item.text}</Text>
                </View>
            </Animated.View>
        );
    }

    return (
        <KeyboardAvoidingView
            style={styles.screen}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
        >
            <LinearGradient
                colors={[palette.cream, "#EFE2D1"]}
                style={StyleSheet.absoluteFill}
            />

            <View style={styles.header}>
                <Text style={styles.headerTitle}>JuaKali Agent</Text>
                <Text style={styles.headerSubtitle}>Powered by Gemini on Google Cloud</Text>
            </View>

            {messages.length === 0 ? (
                <View style={styles.emptyState}>
                    <Text style={styles.emptyTitle}>Talk to the JuaKali Agent</Text>
                    <Text style={styles.emptyBody}>
                        Try registering a master artisan, finding matches, or checking system status.
                    </Text>
                    <View style={styles.quickPrompts}>
                        {quickPrompts.map((prompt) => (
                            <Pressable
                                key={prompt}
                                onPress={() => sendMessage(prompt)}
                                style={styles.quickPrompt}
                            >
                                <Text style={styles.quickPromptText}>{prompt}</Text>
                            </Pressable>
                        ))}
                    </View>
                </View>
            ) : (
                <FlatList
                    ref={listRef}
                    data={messages}
                    renderItem={renderMessage}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={styles.messageList}
                    onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
                />
            )}

            <View style={styles.inputRow}>
                <TextInput
                    value={inputText}
                    onChangeText={setInputText}
                    placeholder="Ask the agent..."
                    placeholderTextColor="rgba(36,49,36,0.4)"
                    style={styles.input}
                    multiline
                    editable={!isSending}
                    onSubmitEditing={() => sendMessage(inputText)}
                />
                <Pressable
                    onPress={() => sendMessage(inputText)}
                    disabled={isSending || !inputText.trim()}
                    style={[styles.sendButton, (isSending || !inputText.trim()) && styles.sendDisabled]}
                >
                    {isSending ? (
                        <ActivityIndicator color="#FFFDF7" size="small" />
                    ) : (
                        <Text style={styles.sendText}>Send</Text>
                    )}
                </Pressable>
            </View>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1 },
    header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
    headerTitle: { color: palette.olive, fontSize: 24, fontWeight: "800", letterSpacing: -1 },
    headerSubtitle: { color: palette.moss, fontSize: 12, fontWeight: "700", marginTop: 2 },

    emptyState: { flex: 1, justifyContent: "center", paddingHorizontal: 20, gap: 12 },
    emptyTitle: { color: palette.olive, fontSize: 22, fontWeight: "800", letterSpacing: -0.5 },
    emptyBody: { color: "rgba(36,49,36,0.7)", fontSize: 14, fontWeight: "300", lineHeight: 20 },
    quickPrompts: { gap: 8, marginTop: 8 },
    quickPrompt: {
        padding: 14,
        backgroundColor: "rgba(255,253,247,0.82)",
        borderRadius: 18,
        borderTopLeftRadius: 6,
        borderWidth: 1,
        borderColor: "rgba(59,77,59,0.12)",
    },
    quickPromptText: { color: palette.olive, fontSize: 13, fontWeight: "600", lineHeight: 18 },

    messageList: { paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
    messageRow: { alignItems: "flex-end" },
    agentRow: { alignItems: "flex-start" },
    bubble: { maxWidth: "82%", paddingHorizontal: 16, paddingVertical: 12 },
    userBubble: {
        backgroundColor: palette.terracotta,
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
        borderBottomLeftRadius: 18,
        borderBottomRightRadius: 4,
    },
    agentBubble: {
        backgroundColor: "rgba(255,253,247,0.9)",
        borderTopLeftRadius: 4,
        borderTopRightRadius: 18,
        borderBottomLeftRadius: 18,
        borderBottomRightRadius: 18,
        borderWidth: 1,
        borderColor: "rgba(59,77,59,0.1)",
    },
    bubbleText: { color: "#FFFDF7", fontSize: 14, fontWeight: "500", lineHeight: 20 },
    agentText: { color: palette.ink },

    inputRow: {
        flexDirection: "row",
        alignItems: "flex-end",
        paddingHorizontal: 12,
        paddingVertical: 8,
        gap: 8,
        borderTopWidth: 1,
        borderTopColor: "rgba(59,77,59,0.1)",
        backgroundColor: "rgba(245,241,232,0.95)",
    },
    input: {
        flex: 1,
        minHeight: 42,
        maxHeight: 120,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 21,
        backgroundColor: "rgba(255,253,247,0.9)",
        borderWidth: 1,
        borderColor: "rgba(59,77,59,0.16)",
        color: palette.ink,
        fontSize: 14,
    },
    sendButton: {
        paddingHorizontal: 20,
        paddingVertical: 11,
        borderRadius: 21,
        backgroundColor: palette.terracotta,
        minWidth: 72,
        alignItems: "center",
    },
    sendDisabled: { opacity: 0.5 },
    sendText: { color: "#FFFDF7", fontSize: 14, fontWeight: "800" },
});
