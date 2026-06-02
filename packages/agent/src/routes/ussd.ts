import { Router } from "express";
import { convexMutation } from "../convex-client.js";

export const ussdRouter = Router();

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

function normalizeKey(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "unknown";
}

ussdRouter.post("/", async (req, res) => {
    const payload = req.body as Record<string, string>;
    const sessionId = field(payload, ["sessionId", "SessionId"]);
    const serviceCode = field(payload, ["serviceCode", "ServiceCode"]);
    const phoneNumber = normalizePhone(field(payload, ["phoneNumber", "From", "from"]));
    const text = field(payload, ["text", "Text"]);

    const segments = text
        .split("*")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

    try {
        const reply = await convexMutation<string>("telephony:handleUssdWebhook", {
            sessionId,
            serviceCode,
            phoneNumber,
            text,
            provider: "mock",
            rawPayload: JSON.stringify(payload),
        });

        res.type("text/plain").send(reply);
    } catch (error) {
        console.error("USSD error:", error);
        res.type("text/plain").send("END Service temporarily unavailable. Please try again later.");
    }
});
