import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

import {
    type ExtractedMasterProfile,
    heuristicExtractMasterProfile,
    splitSkills,
} from "./juaKaliHelpers";

interface GeminiGenerateContentResponse {
    candidates?: Array<{
        content?: {
            parts?: Array<{ text?: string }>;
        };
    }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | null {
    const value = record[key];
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function languageField(value: string | null): ExtractedMasterProfile["language"] {
    if (value === "sw" || value === "en" || value === "mixed") return value;
    return "unknown";
}

function parseExtractedProfile(value: unknown, transcript: string, fallbackPhone: string | null): ExtractedMasterProfile {
    if (!isRecord(value)) return heuristicExtractMasterProfile(transcript, fallbackPhone);

    const name = stringField(value, "name") ?? stringField(value, "Name") ?? fallbackPhone ?? "Unnamed Master";
    const locationText = stringField(value, "locationText") ?? stringField(value, "location") ?? stringField(value, "town") ?? "Unknown location";
    const craftText = stringField(value, "craftText") ?? stringField(value, "craft") ?? stringField(value, "trade") ?? "general artisan skills";
    const skillsValue = value.keySkills ?? value.skills;
    const keySkills = Array.isArray(skillsValue)
        ? skillsValue.filter((skill): skill is string => typeof skill === "string" && skill.trim().length > 0).slice(0, 6)
        : splitSkills(stringField(value, "keySkills") ?? craftText);

    return {
        name,
        locationText,
        craftText,
        keySkills: keySkills.length > 0 ? keySkills : [craftText],
        profileSummary: stringField(value, "profileSummary") ?? transcript.slice(0, 280),
        language: languageField(stringField(value, "language")),
    };
}

function requireApiKey(): string {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error("GOOGLE_API_KEY environment variable is required but not set");
    return apiKey;
}

async function readJsonResponse(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!response.ok) throw new Error(`Gemini request failed (${response.status}): ${text.slice(0, 300)}`);
    return JSON.parse(text) as unknown;
}

function extractTextFromGeminiResponse(json: GeminiGenerateContentResponse): string | null {
    const parts = json.candidates?.[0]?.content?.parts;
    if (!parts || parts.length === 0) return null;
    const text = parts.map((part) => part.text ?? "").join("").trim();
    return text.length > 0 ? text : null;
}

async function transcribeRecording(recordingUrl: string): Promise<string> {
    const apiKey = requireApiKey();
    const audioResponse = await fetch(recordingUrl);
    if (!audioResponse.ok) {
        throw new Error(`Could not fetch recording (${audioResponse.status}) from provider URL`);
    }

    const audioBuffer = await audioResponse.arrayBuffer();
    const base64Audio = Buffer.from(audioBuffer).toString("base64");
    const mimeType = audioResponse.headers.get("content-type") ?? "audio/mpeg";

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: "Transcribe this audio recording. Return only the spoken words as plain text. The audio may contain Swahili, English, or a mix of both." },
                        { inline_data: { mime_type: mimeType, data: base64Audio } },
                    ],
                }],
            }),
        }
    );
    const json = (await readJsonResponse(response)) as GeminiGenerateContentResponse;
    const text = extractTextFromGeminiResponse(json);
    if (!text) throw new Error("Transcription response did not include text");
    return text;
}

async function extractProfileWithLlm(transcript: string, fallbackPhone: string | null): Promise<ExtractedMasterProfile> {
    const apiKey = requireApiKey();
    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: `Extract a Kenyan Jua Kali master artisan profile from this transcript. Return only valid JSON with keys: name (string), locationText (string), craftText (string), keySkills (array of max 6 strings), profileSummary (string), language (one of: "sw", "en", "mixed", "unknown").\n\nTranscript: ${transcript}`,
                    }],
                }],
                generationConfig: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: "object",
                        properties: {
                            name: { type: "string" },
                            locationText: { type: "string" },
                            craftText: { type: "string" },
                            keySkills: { type: "array", items: { type: "string" } },
                            profileSummary: { type: "string" },
                            language: { type: "string", enum: ["sw", "en", "mixed", "unknown"] },
                        },
                        required: ["name", "locationText", "craftText", "keySkills", "profileSummary", "language"],
                    },
                },
            }),
        }
    );
    const json = (await readJsonResponse(response)) as GeminiGenerateContentResponse;
    const text = extractTextFromGeminiResponse(json);
    if (!text) return heuristicExtractMasterProfile(transcript, fallbackPhone);
    try {
        return parseExtractedProfile(JSON.parse(text) as unknown, transcript, fallbackPhone);
    } catch {
        return heuristicExtractMasterProfile(transcript, fallbackPhone);
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Unknown voice processing error";
}

export const processVoiceIntake = internalAction({
    args: { voiceIntakeId: v.id("voiceIntakes") },
    returns: v.null(),
    handler: async (ctx, args) => {
        const intake = await ctx.runQuery(internal.telephony.getVoiceIntakeForProcessing, {
            voiceIntakeId: args.voiceIntakeId,
        });
        if (!intake) return null;

        try {
            const transcript = intake.transcript ?? (intake.recordingUrl ? await transcribeRecording(intake.recordingUrl) : null);
            if (!transcript) throw new Error("Voice intake needs either a recording URL or transcript text");
            const extracted = await extractProfileWithLlm(transcript, intake.fromPhone);
            await ctx.runMutation(internal.telephony.completeVoiceIntake, {
                voiceIntakeId: args.voiceIntakeId,
                transcript,
                ...extracted,
            });
        } catch (error) {
            await ctx.runMutation(internal.telephony.markVoiceIntakeFailed, {
                voiceIntakeId: args.voiceIntakeId,
                errorMessage: errorMessage(error),
            });
        }

        return null;
    },
});

// Batch process all queued voice intakes (called by cron every 5 minutes).
export const processQueuedVoiceIntakes = internalAction({
    args: {},
    returns: v.object({ processed: v.number(), failed: v.number() }),
    handler: async (ctx) => {
        const queued = await ctx.runQuery(
            internal.telephony.getQueuedVoiceIntakes, {}
        );

        let processed = 0;
        let failed = 0;

        for (const intake of queued) {
            try {
                const transcript = intake.transcript ?? (intake.recordingUrl ? await transcribeRecording(intake.recordingUrl) : null);
                if (!transcript) {
                    await ctx.runMutation(internal.telephony.markVoiceIntakeFailed, {
                        voiceIntakeId: intake._id,
                        errorMessage: "Voice intake needs either a recording URL or transcript text",
                    });
                    failed++;
                    continue;
                }
                const extracted = await extractProfileWithLlm(transcript, intake.fromPhone);
                await ctx.runMutation(internal.telephony.completeVoiceIntake, {
                    voiceIntakeId: intake._id,
                    transcript,
                    ...extracted,
                });
                processed++;
            } catch (error) {
                await ctx.runMutation(internal.telephony.markVoiceIntakeFailed, {
                    voiceIntakeId: intake._id,
                    errorMessage: errorMessage(error),
                });
                failed++;
            }
        }

        return { processed, failed };
    },
});
