"use node";

import { v } from "convex/values";
import { Webhook } from "svix";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

const API = "https://api.agentmail.to";

function apiKey(): string {
     
    const key = process.env.AGENTMAIL_API_KEY;
    if (!key) throw new Error("AGENTMAIL_API_KEY is not set on this Convex deployment");
    return key;
}

function siteUrl(): string {
     
    const site = (process.env.CONVEX_SITE_URL ?? "").replace(/\/$/, "");
    if (!site) throw new Error("CONVEX_SITE_URL missing");
    return site;
}

async function amFetch(path: string, init?: RequestInit) {
    const res = await fetch(`${API}${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${apiKey()}`,
            "Content-Type": "application/json",
            ...(init?.headers ?? {}),
        },
    });
    const text = await res.text();
    let json: unknown = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = { raw: text };
    }
    if (!res.ok) {
        const err = new Error(`AgentMail ${res.status}: ${text.slice(0, 500)}`) as Error & {
            status?: number;
            body?: unknown;
        };
        err.status = res.status;
        err.body = json;
        throw err;
    }
    return json as Record<string, unknown>;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string {
    for (const key of keys) {
        const val = obj[key];
        if (typeof val === "string" && val.length > 0) return val;
    }
    return "";
}

/**
 * Bind / provision AgentMail.
 *
 * - Org keys: creates inbox + webhook automatically.
 * - Inbox-scoped keys (am_us_inbox_*): pass inboxId (email address) — webhook
 *   must be created in the AgentMail console if the key lacks webhook_create.
 */
export const setup = action({
    args: {
        clientId: v.optional(v.string()),
        /** Existing inbox id / email when using an inbox-scoped API key. */
        inboxId: v.optional(v.string()),
        inboxEmail: v.optional(v.string()),
    },
    returns: v.object({
        inboxId: v.string(),
        inboxEmail: v.string(),
        webhookId: v.union(v.string(), v.null()),
        webhookSecretSet: v.boolean(),
        webhookUrl: v.string(),
        message: v.string(),
    }),
    handler: async (ctx, args) => {
        const webhookUrl = `${siteUrl()}/webhooks/agentmail`;
        let inboxId = args.inboxId?.trim() || "";
        let inboxEmail = args.inboxEmail?.trim() || inboxId;
        const messageParts: string[] = [];

        if (!inboxId) {
            const clientId = args.clientId ?? "juakali-agent-inbox-v1";
            try {
                const inbox = await amFetch("/v0/inboxes", {
                    method: "POST",
                    body: JSON.stringify({ client_id: clientId }),
                }).catch(async () =>
                    amFetch("/inboxes", {
                        method: "POST",
                        body: JSON.stringify({ client_id: clientId }),
                    })
                );
                inboxId = pickString(inbox, ["inbox_id", "inboxId", "id", "email"]);
                inboxEmail = pickString(inbox, ["email", "address", "inbox_id", "inboxId"]) || inboxId;
                messageParts.push("Created inbox.");
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                if (msg.includes("inbox_create") || msg.includes("missing_permission")) {
                    throw new Error(
                        "This AGENTMAIL_API_KEY cannot create inboxes (likely inbox-scoped). " +
                            "Re-run with { inboxId: \"you@agentmail.to\" } from the AgentMail console, " +
                            "or use an organization-scoped API key."
                    );
                }
                throw err;
            }
        } else {
            messageParts.push("Bound existing inbox.");
        }

        if (!inboxId) throw new Error("No inbox id");

        let webhookId: string | null = null;
        let secret = "";
        try {
            const webhook = await amFetch("/v0/webhooks", {
                method: "POST",
                body: JSON.stringify({
                    url: webhookUrl,
                    event_types: ["message.received"],
                    client_id: "juakali-agentmail-webhook-v1",
                    inbox_ids: [inboxId],
                }),
            }).catch(async () =>
                amFetch("/webhooks", {
                    method: "POST",
                    body: JSON.stringify({
                        url: webhookUrl,
                        eventTypes: ["message.received"],
                        clientId: "juakali-agentmail-webhook-v1",
                        inboxIds: [inboxId],
                    }),
                })
            );
            webhookId = pickString(webhook, ["webhook_id", "webhookId", "id"]) || null;
            secret = pickString(webhook, ["secret"]);
            messageParts.push("Registered webhook.");
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            messageParts.push(
                "Could not create webhook with this key — create one in the AgentMail console " +
                    `pointing to ${webhookUrl} (message.received), then set AGENTMAIL_WEBHOOK_SECRET. (${msg.slice(0, 120)})`
            );
        }

        await ctx.runMutation(internal.agentMailStore.saveConfig, {
            inboxId,
            inboxEmail: inboxEmail || inboxId,
            webhookId: webhookId ?? undefined,
            webhookSecret: secret || undefined,
        });

        return {
            inboxId,
            inboxEmail: inboxEmail || inboxId,
            webhookId,
            webhookSecretSet: Boolean(secret),
            webhookUrl,
            message: messageParts.join(" "),
        };
    },
});

export const status = action({
    args: {},
    returns: v.object({
        apiKeyConfigured: v.boolean(),
        inboxId: v.union(v.string(), v.null()),
        inboxEmail: v.union(v.string(), v.null()),
        webhookId: v.union(v.string(), v.null()),
        webhookSecretConfigured: v.boolean(),
        webhookUrl: v.string(),
    }),
    handler: async (ctx) => {
         
        const apiKeyConfigured = Boolean(process.env.AGENTMAIL_API_KEY);
        const envSecret = Boolean(process.env.AGENTMAIL_WEBHOOK_SECRET);
         
        const config = await ctx.runQuery(internal.agentMailStore.getConfig, {});
        const storedSecret = await ctx.runQuery(internal.agentMailStore.hasWebhookSecret, {});
        return {
            apiKeyConfigured,
            inboxId: config?.inboxId ?? null,
            inboxEmail: config?.inboxEmail ?? null,
            webhookId: config?.webhookId ?? null,
            webhookSecretConfigured: envSecret || storedSecret,
            webhookUrl: `${siteUrl()}/webhooks/agentmail`,
        };
    },
});

export const sendTest = action({
    args: {
        to: v.string(),
        subject: v.optional(v.string()),
        text: v.optional(v.string()),
        inboxId: v.optional(v.string()),
    },
    returns: v.object({ ok: v.boolean(), message: v.string() }),
    handler: async (ctx, args) => {
        const config = await ctx.runQuery(internal.agentMailStore.getConfig, {});
        const inboxId = args.inboxId ?? config?.inboxId;
        if (!inboxId) {
            return { ok: false, message: "No inbox bound — run agentMail.setup with inboxId." };
        }
        const payload = {
            to: args.to,
            subject: args.subject ?? "JuaKali AgentMail test",
            text: args.text ?? "Soft pledge path is live — AgentMail inbox wired to Convex.",
        };
        try {
            await amFetch(`/v0/inboxes/${encodeURIComponent(inboxId)}/messages/send`, {
                method: "POST",
                body: JSON.stringify(payload),
            });
        } catch {
            await amFetch(`/inboxes/${encodeURIComponent(inboxId)}/messages/send`, {
                method: "POST",
                body: JSON.stringify(payload),
            });
        }
        return { ok: true, message: `Sent from ${inboxId}` };
    },
});

/** Verify Svix signature; returns parsed JSON or throws. */
export const verifyAndParse = internalAction({
    args: {
        rawBody: v.string(),
        svixId: v.string(),
        svixTimestamp: v.string(),
        svixSignature: v.string(),
    },
    returns: v.any(),
    handler: async (ctx, args) => {
         
        let secret = process.env.AGENTMAIL_WEBHOOK_SECRET ?? "";
         
        if (!secret) {
            secret = (await ctx.runQuery(internal.agentMailStore.getWebhookSecret, {})) ?? "";
        }
        if (!secret) {
            throw new Error("AGENTMAIL_WEBHOOK_SECRET not configured");
        }
        const wh = new Webhook(secret);
        return wh.verify(args.rawBody, {
            "svix-id": args.svixId,
            "svix-timestamp": args.svixTimestamp,
            "svix-signature": args.svixSignature,
        });
    },
});
