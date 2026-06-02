import { Router } from "express";
import { convexMutation } from "../convex-client.js";
import { runAgent } from "../agent.js";

export const voiceRouter = Router();

function xmlEscape(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function xmlResponse(body: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>\n${body}`;
}

function field(payload: Record<string, string>, names: string[]): string {
    for (const name of names) {
        const value = payload[name];
        if (value && value.trim().length > 0) return value.trim();
    }
    return "";
}

voiceRouter.post("/inbound", (_req, res) => {
    const origin = `${_req.protocol}://${_req.get("host")}`;
    const recordingUrl = `${origin}/webhooks/voice/recording`;

    res.type("text/xml").send(xmlResponse(`<Response>
  <Say language="en-US">Karibu. Welcome to Jua Kali Apprenticeship Matcher.</Say>
  <Say language="en-US">Please state your name, town, craft, and what skills you teach in sixty seconds.</Say>
  <Record action="${xmlEscape(recordingUrl)}" method="POST" maxLength="60" playBeep="true" trim="trim-silence" />
  <Say language="en-US">We did not receive a recording. Please call again.</Say>
</Response>`));
});

voiceRouter.post("/recording", async (req, res) => {
    const payload = req.body as Record<string, string>;
    const fromPhone = field(payload, ["From", "from", "callerNumber", "phoneNumber"]);
    const callSid = field(payload, ["CallSid", "callSid", "sessionId"]);
    const recordingUrl = field(payload, ["RecordingUrl", "recordingUrl", "audioUrl"]);
    const transcriptHint = field(payload, ["TranscriptionText", "transcript", "text"]);

    const provider = field(payload, ["MessageSid", "SmsSid", "CallSid"]) ? "twilio" : "mock";

    try {
        await convexMutation("telephony:recordVoiceWebhook", {
            fromPhone,
            callSid,
            recordingUrl,
            transcriptHint,
            provider,
            rawPayload: JSON.stringify(payload),
        });
    } catch (error) {
        console.error("Failed to record voice webhook:", error);
    }

    res.type("text/xml").send(xmlResponse(`<Response>
  <Say language="en-US">Asante. Your profile has been received and will be matched with apprentices.</Say>
</Response>`));
});

voiceRouter.post("/agent", async (req, res) => {
    const { message } = req.body as { message?: string };
    if (!message) {
        res.status(400).json({ error: "message is required" });
        return;
    }

    try {
        const reply = await runAgent(message);
        res.json({ reply });
    } catch (error) {
        console.error("Agent error:", error);
        res.status(500).json({ error: error instanceof Error ? error.message : "Agent failed" });
    }
});
