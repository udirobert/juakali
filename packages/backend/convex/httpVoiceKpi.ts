/**
 * POST /voice/kpi-checkin
 *
 * Voice-first KPI capture for the founder. The client uploads a short audio
 * recording (base64) plus the venture's KPI unit; Gemini transcribes it
 * (Swahili/English/mixed, same prompt as the telephony path) and extracts the
 * spoken number. The response carries the transcript and the parsed value so
 * the client can CONFIRM with the founder ("I heard: 12,500 — correct?")
 * before anything is logged. Nothing is written here — this endpoint only
 * reads audio and returns text.
 *
 * Auth: `Authorization: Bearer <AGENT_CHAT_TOKEN>` — the same bearer the
 * agent service already uses, so no new secret class.
 */
import type { ActionCtx } from "./_generated/server";
import { env } from "./env";
import { rateLimiter } from "./rateLimit";
import { NUMBER_WORDS, DEFAULT_LOCALE_ORDER } from "./numberWords";

interface GeminiGenerateContentResponse {
    candidates?: Array<{
        content?: {
            parts?: Array<{ text?: string }>;
        };
    }>;
}

function extractText(json: GeminiGenerateContentResponse): string {
    const parts = json.candidates?.[0]?.content?.parts ?? [];
    return parts.map((part) => part.text ?? "").join("").trim();
}

/** Parse the spoken number out of the transcript (digits or locale number words). */
export function parseKpiValue(transcript: string, localeOrder: string[] = DEFAULT_LOCALE_ORDER): number | null {
    // Direct digits first: "12,500" / "12500" / "12 500".
    const digits = transcript.replace(/,/g, " ").match(/\d[\d\s]*\d|\d/);
    if (digits) {
        const value = Number(digits[0].replace(/\s/g, ""));
        if (Number.isFinite(value) && value >= 0) return value;
    }
    // Locale number words (small counts: meetings, jobs). Venture locale first.
    for (const locale of localeOrder) {
        const words = NUMBER_WORDS[locale];
        if (!words) continue;
        for (const [word, value] of Object.entries(words)) {
            if (new RegExp(`\\b${word}\\b`, "i").test(transcript)) return value;
        }
    }
    return null;
}

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export default async function voiceKpiCheckin(ctx: ActionCtx, request: Request): Promise<Response> {
    // Bearer gate — same token class as the agent /chat route.
    const expected = env.VOICE_KPI_TOKEN;
    const got = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!expected || got !== expected) {
        return json({ ok: false, error: "Unauthorized" }, 401);
    }

    // Per-IP throttle: transcription costs a Gemini call.
    const ip =
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        request.headers.get("x-nf-client-connection-ip") ||
        "unknown";
    await rateLimiter.limit(ctx, "voiceKpi", {
        key: ip,
        throws: false,
    });

    let payload: { audioBase64?: string; mimeType?: string };
    try {
        payload = (await request.json()) as typeof payload;
    } catch {
        return json({ ok: false, error: "Invalid JSON body" }, 400);
    }
    const audioBase64 = payload.audioBase64?.trim();
    const mimeType = payload.mimeType?.trim() || "audio/mp4";
    if (!audioBase64) {
        return json({ ok: false, error: "audioBase64 is required" }, 400);
    }
    // 10 MB of base64 ≈ 7.5 MB audio — a short voicenote; reject larger.
    if (audioBase64.length > 10_000_000) {
        return json({ ok: false, error: "Recording too large — keep it under a minute" }, 413);
    }

    const apiKey = env.GOOGLE_API_KEY;
    if (!apiKey) {
        return json({ ok: false, error: "Voice transcription is not configured" }, 503);
    }

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            {
                                text: "Transcribe this audio recording. Return only the spoken words as plain text. The audio may contain Swahili, English, or a mix of both. It is a small business owner reporting their weekly number.",
                            },
                            { inline_data: { mime_type: mimeType, data: audioBase64 } },
                        ],
                    }],
                }),
            }
        );
        if (!response.ok) {
            const detail = await response.text();
            return json({ ok: false, error: `Transcription failed (${response.status}): ${detail.slice(0, 200)}` }, 502);
        }
        const transcript = extractText((await response.json()) as GeminiGenerateContentResponse);
        if (!transcript) {
            return json({ ok: false, error: "Could not hear a number — try again" }, 422);
        }
        return json({ ok: true, transcript, value: parseKpiValue(transcript) });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Transcription error";
        return json({ ok: false, error: message }, 502);
    }
}
