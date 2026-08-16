import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

type SpeechRecognitionLike = {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    start: () => void;
    stop: () => void;
    onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
    onend: (() => void) | null;
    onerror: (() => void) | null;
};

/**
 * Dictation — the voicenote gesture, web edition. Uses the browser speech
 * API where it exists (Chrome/Safari); every other platform degrades
 * silently to a keyboard. Speech → text → a shared item tagged "voice".
 */
export function useDictation(onText: (text: string) => void) {
    const [listening, setListening] = useState(false);
    const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
    const onTextRef = useRef(onText);
    onTextRef.current = onText;

    const supported =
        Platform.OS === "web" &&
        typeof window !== "undefined" &&
        Boolean(
            (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ??
                (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition,
        );

    useEffect(() => {
        if (!supported) return;
        const Ctor =
            ((window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition ??
                (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike })
                    .webkitSpeechRecognition)!;
        const recognition = new Ctor();
        recognition.lang = "en-KE";
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.onresult = (event) => {
            for (let i = event.resultIndex; i < event.results.length; i += 1) {
                const transcript = event.results[i]?.[0]?.transcript?.trim();
                if (transcript) onTextRef.current(transcript);
            }
        };
        recognition.onend = () => setListening(false);
        recognition.onerror = () => setListening(false);
        recognitionRef.current = recognition;
        return () => {
            recognition.onresult = null;
            recognition.onend = null;
            recognition.onerror = null;
            try {
                recognition.stop();
            } catch {
                // already stopped
            }
            recognitionRef.current = null;
        };
    }, [supported]);

    const toggle = useCallback(() => {
        const recognition = recognitionRef.current;
        if (!recognition) return;
        if (listening) {
            recognition.stop();
            setListening(false);
        } else {
            try {
                recognition.start();
                setListening(true);
            } catch {
                // start() throws if already starting — ignore
            }
        }
    }, [listening]);

    return { supported, listening, toggle };
}
