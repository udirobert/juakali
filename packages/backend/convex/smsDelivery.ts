"use node";

import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";

interface QueuedMessage {
    id: Id<"outboundMessages">;
    recipientPhone: string;
    body: string;
    provider: "twilio" | "africas_talking" | "mock";
}

function requiredEnv(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`${name} environment variable is required but not set`);
    return value;
}

function optionalEnv(name: string): string | null {
    const value = process.env[name];
    return value && value.trim().length > 0 ? value : null;
}

function stringField(value: unknown, key: string): string | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const fieldValue = (value as Record<string, unknown>)[key];
    return typeof fieldValue === "string" && fieldValue.length > 0 ? fieldValue : null;
}

async function parseJson(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!response.ok) throw new Error(`SMS provider request failed (${response.status}): ${text.slice(0, 300)}`);
    if (text.trim().length === 0) return null;
    return JSON.parse(text) as unknown;
}

async function sendWithTwilio(message: QueuedMessage): Promise<string> {
    const accountSid = requiredEnv("TWILIO_ACCOUNT_SID");
    const authToken = requiredEnv("TWILIO_AUTH_TOKEN");
    const fromNumber = requiredEnv("TWILIO_FROM_NUMBER");
    const body = new URLSearchParams({
        From: fromNumber,
        To: message.recipientPhone,
        Body: message.body,
    });

    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method: "POST",
        headers: {
            Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
    });
    const json = await parseJson(response);
    return stringField(json, "sid") ?? `twilio:${message.id}`;
}

async function sendWithAfricasTalking(message: QueuedMessage): Promise<string> {
    const username = requiredEnv("AFRICAS_TALKING_USERNAME");
    const apiKey = requiredEnv("AFRICAS_TALKING_API_KEY");
    const senderId = optionalEnv("AFRICAS_TALKING_SENDER_ID");
    const body = new URLSearchParams({
        username,
        to: message.recipientPhone,
        message: message.body,
    });
    if (senderId) body.set("from", senderId);

    const response = await fetch("https://api.africastalking.com/version1/messaging", {
        method: "POST",
        headers: {
            Accept: "application/json",
            apiKey,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
    });
    await parseJson(response);
    return `africas_talking:${message.id}`;
}

async function deliverMessage(message: QueuedMessage): Promise<string> {
    if (message.provider === "mock") return `mock:${message.id}`;
    if (message.provider === "twilio") return await sendWithTwilio(message);
    return await sendWithAfricasTalking(message);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Unknown SMS delivery error";
}

export const sendQueuedBatch = action({
    args: { limit: v.optional(v.number()) },
    returns: v.object({ attempted: v.number(), sent: v.number(), failed: v.number() }),
    handler: async (ctx, args) => {
        const messages: Array<QueuedMessage> = await ctx.runQuery(internal.telephony.queuedSmsForDelivery, {
            limit: Math.max(1, Math.min(25, args.limit ?? 10)),
        });
        let sent = 0;
        let failed = 0;

        for (const message of messages) {
            try {
                const providerMessageId = await deliverMessage(message);
                await ctx.runMutation(internal.telephony.markOutboundSent, {
                    outboundMessageId: message.id,
                    providerMessageId,
                });
                sent += 1;
            } catch (error) {
                await ctx.runMutation(internal.telephony.markOutboundFailed, {
                    outboundMessageId: message.id,
                    errorMessage: errorMessage(error),
                });
                failed += 1;
            }
        }

        return { attempted: messages.length, sent, failed };
    },
});

// Cron-driven outbox worker: drains queued messages honoring per-message backoff.
export const drainOutbox = internalAction({
    args: {},
    returns: v.object({ attempted: v.number(), sent: v.number(), failed: v.number() }),
    handler: async (ctx): Promise<{ attempted: number; sent: number; failed: number }> => {
        const messages: Array<QueuedMessage> = await ctx.runQuery(internal.telephony.queuedSmsForDelivery, {
            limit: 25,
        });
        let sent = 0;
        let failed = 0;

        for (const message of messages) {
            try {
                const providerMessageId = await deliverMessage(message);
                await ctx.runMutation(internal.telephony.markOutboundSent, {
                    outboundMessageId: message.id,
                    providerMessageId,
                });
                sent += 1;
            } catch (error) {
                await ctx.runMutation(internal.telephony.markOutboundFailed, {
                    outboundMessageId: message.id,
                    errorMessage: errorMessage(error),
                });
                failed += 1;
            }
        }

        return { attempted: messages.length, sent, failed };
    },
});
