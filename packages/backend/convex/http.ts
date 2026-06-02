import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";

const http = httpRouter();

auth.addHttpRoutes(http);

type Provider = "twilio" | "africas_talking" | "mock";
type Payload = Record<string, string>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function parsePayload(request: Request): Promise<Payload> {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
        const json: unknown = await request.json();
        if (!isRecord(json)) return {};
        const payload: Payload = {};
        for (const [key, value] of Object.entries(json)) {
            if (typeof value === "string") payload[key] = value;
            if (typeof value === "number" || typeof value === "boolean") payload[key] = String(value);
        }
        return payload;
    }

    const text = await request.text();
    const params = new URLSearchParams(text);
    const payload: Payload = {};
    for (const [key, value] of params.entries()) payload[key] = value;
    return payload;
}

function field(payload: Payload, names: Array<string>): string {
    for (const name of names) {
        const value = payload[name];
        if (value && value.trim().length > 0) return value.trim();
    }
    return "";
}

function detectProvider(payload: Payload): Provider {
    if (field(payload, ["MessageSid", "SmsSid", "CallSid"])) return "twilio";
    if (field(payload, ["sessionId", "serviceCode", "networkCode"])) return "africas_talking";
    return "mock";
}

function idempotencyKey(payload: Payload): string | null {
    // Provider message SID dedupes retries; AT uses `id`, Twilio uses MessageSid/SmsSid.
    const sid = field(payload, ["MessageSid", "SmsSid", "id", "messageId"]);
    return sid.length > 0 ? sid : null;
}

function xmlEscape(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function xmlResponse(body: string): Response {
    return new Response(body, { status: 200, headers: { "Content-Type": "text/xml" } });
}

function textResponse(body: string): Response {
    return new Response(body, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

http.route({
    path: "/webhooks/voice/inbound",
    method: "POST",
    handler: httpAction(async (_ctx, request) => {
        const origin = new URL(request.url).origin;
        const recordingUrl = `${origin}/webhooks/voice/recording`;
        return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="en-US">Karibu. Welcome to Jua Kali Apprenticeship Matcher.</Say>
  <Say language="en-US">Please state your name, town, craft, and what skills you teach in sixty seconds.</Say>
  <Record action="${xmlEscape(recordingUrl)}" method="POST" maxLength="60" playBeep="true" trim="trim-silence" />
  <Say language="en-US">We did not receive a recording. Please call again.</Say>
</Response>`);
    }),
});

http.route({
    path: "/webhooks/voice/recording",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
        const payload = await parsePayload(request);
        const voiceIntakeId = await ctx.runMutation(internal.telephony.recordVoiceWebhook, {
            fromPhone: field(payload, ["From", "from", "callerNumber", "phoneNumber"]),
            callSid: field(payload, ["CallSid", "callSid", "sessionId"]),
            recordingUrl: field(payload, ["RecordingUrl", "recordingUrl", "audioUrl"]),
            transcriptHint: field(payload, ["TranscriptionText", "transcript", "text"]),
            provider: detectProvider(payload),
            rawPayload: JSON.stringify(payload),
        });
        // Scheduler safe: each recording callback schedules exactly one short background processing job.
        await ctx.scheduler.runAfter(0, internal.voiceProcessing.processVoiceIntake, { voiceIntakeId });

        return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="en-US">Asante. Your profile has been received and will be matched with apprentices.</Say>
</Response>`);
    }),
});

http.route({
    path: "/webhooks/sms/inbound",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
        const payload = await parsePayload(request);
        const result = await ctx.runMutation(internal.telephony.handleSmsWebhook, {
            fromPhone: field(payload, ["From", "from", "phoneNumber", "sender"]),
            body: field(payload, ["Body", "body", "text", "message"]),
            provider: detectProvider(payload),
            rawPayload: JSON.stringify(payload),
            idempotencyKey: idempotencyKey(payload),
        });

        if (detectProvider(payload) === "twilio") {
            return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${xmlEscape(result.reply)}</Message></Response>`);
        }
        return textResponse(result.reply);
    }),
});

http.route({
    path: "/webhooks/ussd",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
        const payload = await parsePayload(request);
        const reply = await ctx.runMutation(internal.telephony.handleUssdWebhook, {
            sessionId: field(payload, ["sessionId", "SessionId"]),
            serviceCode: field(payload, ["serviceCode", "ServiceCode"]),
            phoneNumber: field(payload, ["phoneNumber", "From", "from"]),
            text: field(payload, ["text", "Text"]),
            provider: detectProvider(payload),
            rawPayload: JSON.stringify(payload),
        });
        return textResponse(reply);
    }),
});

http.route({
    path: "/health",
    method: "GET",
    handler: httpAction(async () => textResponse("Jua Kali Matcher webhooks are ready")),
});

export default http;
