import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { auth } from "./auth";

const http = httpRouter();

auth.addHttpRoutes(http);

http.route({
    path: "/soft-auth/inbox",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
         
        const inboxOn = process.env.SOFT_AUTH_INBOX === "1";
        const expected = process.env.SOFT_AUTH_INBOX_SECRET;
         
        if (!inboxOn) {
            return new Response(JSON.stringify({ ok: false, error: "Inbox disabled" }), {
                status: 403,
                headers: { "Content-Type": "application/json" },
            });
        }
        if (expected) {
            const got = request.headers.get("x-soft-auth-secret") ?? "";
            if (got !== expected) {
                return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
                    status: 401,
                    headers: { "Content-Type": "application/json" },
                });
            }
        }
        const json: unknown = await request.json().catch(() => null);
        if (!isRecord(json)) {
            return new Response(JSON.stringify({ ok: false, error: "Invalid JSON" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }
        const email = typeof json.email === "string" ? json.email : "";
        const url = typeof json.url === "string" ? json.url : "";
        if (!email.includes("@") || !url.startsWith("http")) {
            return new Response(JSON.stringify({ ok: false, error: "email and url required" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }
        await ctx.runMutation(internal.softAuth.storeLink, {
            email: email.trim().toLowerCase(),
            url,
        });
        return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    }),
});

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
    path: "/webhooks/revenuecat",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
        const expected = process.env.REVENUECAT_WEBHOOK_SECRET;
        if (!expected) {
            return new Response(JSON.stringify({ ok: false, error: "Not configured" }), {
                status: 503,
                headers: { "Content-Type": "application/json" },
            });
        }
        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
        if (token !== expected) {
            return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
                status: 401,
                headers: { "Content-Type": "application/json" },
            });
        }
        const body: unknown = await request.json().catch(() => null);
        if (!isRecord(body)) {
            return new Response(JSON.stringify({ ok: false, error: "Invalid JSON" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }
        // Newer RevenueCat webhooks nest the event under `event`; support both shapes.
        const event = isRecord(body.event) ? body.event : body;
        const appUserId =
            typeof event["app_user_id"] === "string"
                ? (event["app_user_id"] as string)
                : typeof event["appUserId"] === "string"
                  ? (event["appUserId"] as string)
                  : "";
        if (!appUserId) {
            return new Response(JSON.stringify({ ok: false, error: "Missing app_user_id" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }
        const subscriber = isRecord(event.subscriber) ? event.subscriber : {};
        const entitlementsObj = isRecord(subscriber.entitlements) ? subscriber.entitlements : {};

        const now = Date.now();
        const active: Array<string> = [];
        let productId: string | null = null;
        let expiresAt: number | null = null;
        for (const [key, e] of Object.entries(entitlementsObj)) {
            if (!isRecord(e)) continue;
            const expiry = typeof e.expires_date === "string" ? Date.parse(e.expires_date) : NaN;
            const isActive =
                e.active === true || e.active === "true" || (Number.isFinite(expiry) && expiry > now);
            if (isActive) {
                active.push(key);
                if (typeof e.product_identifier === "string") productId = e.product_identifier;
                if (Number.isFinite(expiry)) expiresAt = expiry;
            }
        }
        const status = active.length > 0 ? "active" : "expired";

        await ctx.runMutation(internal.subscriptions.setEntitlements, {
            revenueCatAppUserId: appUserId,
            entitlements: active,
            productId,
            status,
            expiresAt,
        });
        return new Response(JSON.stringify({ ok: true, entitlements: active }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    }),
});

http.route({
    path: "/webhooks/agentmail",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
        const rawBody = await request.text();

        const svixId = request.headers.get("svix-id");
        const svixTimestamp = request.headers.get("svix-timestamp");
        const svixSignature = request.headers.get("svix-signature");

        let json: unknown;
         
        const envSecret = process.env.AGENTMAIL_WEBHOOK_SECRET;
         
        const storedSecret = await ctx.runQuery(internal.agentMailStore.getWebhookSecret, {});
        const mustVerify = Boolean(envSecret || storedSecret);

        if (mustVerify) {
            if (!svixId || !svixTimestamp || !svixSignature) {
                return new Response(JSON.stringify({ ok: false, error: "Missing Svix headers" }), {
                    status: 400,
                    headers: { "Content-Type": "application/json" },
                });
            }
            try {
                json = await ctx.runAction(internal.agentMail.verifyAndParse, {
                    rawBody,
                    svixId,
                    svixTimestamp,
                    svixSignature,
                });
            } catch (err) {
                console.error("[agentmail] webhook verify failed", err);
                return new Response(JSON.stringify({ ok: false, error: "Invalid signature" }), {
                    status: 400,
                    headers: { "Content-Type": "application/json" },
                });
            }
        } else {
            try {
                json = JSON.parse(rawBody) as unknown;
            } catch {
                return new Response(JSON.stringify({ ok: false, error: "Invalid JSON" }), {
                    status: 400,
                    headers: { "Content-Type": "application/json" },
                });
            }
        }

        if (!isRecord(json)) {
            return new Response(JSON.stringify({ ok: false, error: "Invalid JSON" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }

        const eventType = typeof json.event_type === "string" ? json.event_type : "";
        const message = isRecord(json.message) ? json.message : json;

        const toList = Array.isArray(message.to) ? message.to : [];
        const fromList = Array.isArray(message.from_)
            ? message.from_
            : Array.isArray(message.from)
              ? message.from
              : [];

        const firstAddr = (list: unknown[]): string => {
            const first = list[0];
            if (typeof first === "string") return first;
            if (isRecord(first) && typeof first.email === "string") return first.email;
            if (isRecord(first) && typeof first.address === "string") return first.address;
            return "";
        };

        const toAddress =
            firstAddr(toList) ||
            (typeof message.toAddress === "string" ? message.toAddress : "") ||
            (typeof json.toAddress === "string" ? json.toAddress : "") ||
            (typeof message.inbox_id === "string" ? message.inbox_id : "");
        const fromAddress =
            firstAddr(fromList) ||
            (typeof message.from === "string" ? message.from : "") ||
            (typeof message.fromAddress === "string" ? message.fromAddress : "") ||
            (typeof json.fromAddress === "string" ? json.fromAddress : "");
        const subject =
            (typeof message.subject === "string" ? message.subject : undefined) ||
            (typeof json.subject === "string" ? json.subject : undefined);
        const body =
            (typeof message.text === "string" ? message.text : "") ||
            (typeof message.extracted_text === "string" ? message.extracted_text : "") ||
            (typeof message.extractedText === "string" ? message.extractedText : "") ||
            (typeof message.preview === "string" ? message.preview : "") ||
            (typeof message.body === "string" ? message.body : "") ||
            (typeof json.body === "string" ? json.body : "");
        const eventId = typeof json.event_id === "string" ? json.event_id : undefined;

        if (eventType && !eventType.startsWith("message.received") && eventType !== "demo.inbound") {
            return new Response(JSON.stringify({ ok: true, ignored: eventType }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }

        if (!toAddress || !fromAddress || !body) {
            return new Response(
                JSON.stringify({ ok: false, error: "toAddress, fromAddress, and body are required" }),
                { status: 400, headers: { "Content-Type": "application/json" } }
            );
        }

        const result = await ctx.runMutation(api.invest.handleAgentMailInbound, {
            toAddress,
            fromAddress,
            subject,
            body,
            eventId,
        });

        return new Response(JSON.stringify(result), {
            status: result.ok ? 200 : 404,
            headers: { "Content-Type": "application/json" },
        });
    }),
});

http.route({
    path: "/health",
    method: "GET",
    handler: httpAction(async () => textResponse("Jua Kali Matcher webhooks are ready")),
});

export default http;
