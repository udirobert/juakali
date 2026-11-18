/**
 * Voice KPI capture — the founder speaks their number, confirms, it logs.
 *
 * Flow (honest at every step):
 *   1. Record via the browser MediaRecorder (web) — native expo-av recording
 *      is the follow-up; on native without expo-av this hook reports
 *      unsupported and the keyboard path stays.
 *   2. Upload to POST /voice/kpi-checkin (bearer-gated) → transcript + value.
 *   3. The UI shows "I heard: 12,500 — correct?" — nothing is logged until
 *      the founder confirms. A misheard number is a tap to correct.
 */
import { useCallback, useRef, useState } from "react";
import { Platform } from "react-native";

export type VoiceKpiState = {
    supported: boolean;
    recording: boolean;
    transcribing: boolean;
    /** What the server heard — shown for confirmation. */
    draft: { transcript: string; value: number | null } | null;
    error: string | null;
    start: () => void;
    stop: () => void;
    clear: () => void;
    /** Founder confirmed the heard number — logs it. */
    confirm: () => void;
};

/** Resolve the Convex site URL (same origin the app already talks to). */
function siteUrl(): string {
    const url = process.env.EXPO_PUBLIC_CONVEX_SITE_URL;
    return (url ?? "https://zealous-scorpion-285.convex.site").replace(/\/$/, "");
}

export function useVoiceKpi(onConfirmed: (value: number, transcript: string) => void): VoiceKpiState {
    const supported = Platform.OS === "web" && typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
    const [recording, setRecording] = useState(false);
    const [transcribing, setTranscribing] = useState(false);
    const [draft, setDraft] = useState<{ transcript: string; value: number | null } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const onConfirmedRef = useRef(onConfirmed);
    onConfirmedRef.current = onConfirmed;

    const start = useCallback(() => {
        if (!supported) return;
        setError(null);
        setDraft(null);
        chunksRef.current = [];
        void navigator.mediaDevices
            .getUserMedia({ audio: true })
            .then((stream) => {
                const recorder = new MediaRecorder(stream);
                recorder.ondataavailable = (event) => {
                    if (event.data.size > 0) chunksRef.current.push(event.data);
                };
                recorder.onstop = () => {
                    stream.getTracks().forEach((track) => track.stop());
                    const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
                    if (blob.size === 0) {
                        setError("Nothing recorded — try again.");
                        return;
                    }
                    setTranscribing(true);
                    void blob
                        .arrayBuffer()
                        .then(async (buffer) => {
                            const base64 = btoa(
                                Array.from(new Uint8Array(buffer), (byte) => String.fromCharCode(byte)).join("")
                            );
                            const response = await fetch(`${siteUrl()}/voice/kpi-checkin`, {
                                method: "POST",
                                headers: {
                                    "Content-Type": "application/json",
                                    Authorization: `Bearer ${process.env.EXPO_PUBLIC_VOICE_KPI_TOKEN ?? ""}`,
                                },
                                body: JSON.stringify({ audioBase64: base64, mimeType: blob.type }),
                            });
                            const json = (await response.json()) as {
                                ok: boolean;
                                transcript?: string;
                                value?: number | null;
                                error?: string;
                            };
                            if (!json.ok || !json.transcript) {
                                setError(json.error ?? "Could not hear a number — try again.");
                                return;
                            }
                            setDraft({ transcript: json.transcript, value: json.value ?? null });
                        })
                        .catch(() => setError("Network problem — try again."))
                        .finally(() => setTranscribing(false));
                };
                recorderRef.current = recorder;
                recorder.start();
                setRecording(true);
            })
            .catch(() => setError("Microphone unavailable — type the number instead."));
    }, [supported]);

    const stop = useCallback(() => {
        const recorder = recorderRef.current;
        if (!recorder) return;
        recorder.stop();
        recorderRef.current = null;
        setRecording(false);
    }, []);

    const clear = useCallback(() => {
        setDraft(null);
        setError(null);
    }, []);

    // Confirm is exposed via the returned object's consumer: the UI calls
    // onConfirmed with the parsed value when the founder taps "Correct".
    const confirm = useCallback(() => {
        if (draft?.value != null) onConfirmedRef.current(draft.value, draft.transcript);
        setDraft(null);
    }, [draft]);

    return { supported, recording, transcribing, draft, error, start, stop, clear, confirm };
}
