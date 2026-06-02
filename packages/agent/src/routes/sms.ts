import { Router } from "express";
import { convexMutation } from "../convex-client.js";
import { runAgent } from "../agent.js";

export const smsRouter = Router();

function field(payload: Record<string, string>, names: string[]): string {
    for (const name of names) {
        const value = payload[name];
        if (value && value.trim().length > 0) return value.trim();
    }
    return "";
}

function normalizePhone(value: string): string {
    const trimmed = value.trim();
    if (trimmed.startsWith("+")) return trimmed;
    if (trimmed.startsWith("0")) return `+254${trimmed.slice(1)}`;
    if (trimmed.startsWith("254")) return `+${trimmed}`;
    return trimmed;
}

function xmlEscape(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

smsRouter.post("/inbound", async (req, res) => {
    const payload = req.body as Record<string, string>;
    const fromPhone = field(payload, ["From", "from", "phoneNumber", "sender"]);
    const body = field(payload, ["Body", "body", "text", "message"]);
    const provider = field(payload, ["MessageSid", "SmsSid"]) ? "twilio" : "mock";
    const idempotencyKey = field(payload, ["MessageSid", "SmsSid", "id", "messageId"]) || null;

    const phoneNumber = normalizePhone(fromPhone);

    try {
        const agentPrompt = `SMS received from ${phoneNumber}: "${body}"

Process this SMS message. If it's a new user, start the welcome flow. If they're providing location or craft info during an interview, advance the flow. If they're confirming a match (replying 1 or 2), record the confirmation. Use your tools to take the appropriate actions and compose the reply SMS.`;

        const reply = await runAgent(agentPrompt);

        if (provider === "twilio") {
            res.type("text/xml").send(
                `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${xmlEscape(reply)}</Message></Response>`
            );
        } else {
            res.type("text/plain").send(reply);
        }
    } catch (error) {
        console.error("SMS agent error:", error);
        const fallbackReply = "Asante! We received your message and will respond shortly.";
        if (provider === "twilio") {
            res.type("text/xml").send(
                `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${xmlEscape(fallbackReply)}</Message></Response>`
            );
        } else {
            res.type("text/plain").send(fallbackReply);
        }
    }
});

smsRouter.post("/agent", async (req, res) => {
    const { phoneNumber, body } = req.body as { phoneNumber?: string; body?: string };
    if (!phoneNumber || !body) {
        res.status(400).json({ error: "phoneNumber and body are required" });
        return;
    }

    try {
        const reply = await runAgent(
            `SMS from ${phoneNumber}: "${body}" — Process this message using your tools and return the SMS reply text only.`
        );
        res.json({ reply });
    } catch (error) {
        console.error("SMS agent error:", error);
        res.status(500).json({ error: error instanceof Error ? error.message : "Agent failed" });
    }
});
