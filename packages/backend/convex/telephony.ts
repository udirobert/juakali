import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";

import { normalizeKey, normalizePhone, scoreMaster } from "./juaKaliHelpers";

const channelValidator = v.union(v.literal("sms"), v.literal("ussd"), v.literal("voice"));
const messageProviderValidator = v.union(v.literal("twilio"), v.literal("africas_talking"), v.literal("mock"));
const languageValidator = v.union(v.literal("sw"), v.literal("en"), v.literal("mixed"), v.literal("unknown"));

const masterSummaryValidator = v.object({
    id: v.id("masters"),
    name: v.string(),
    phoneNumber: v.union(v.string(), v.null()),
    locationText: v.string(),
    craftText: v.string(),
    keySkills: v.array(v.string()),
    profileSummary: v.string(),
    transcript: v.union(v.string(), v.null()),
    originalAudioUrl: v.union(v.string(), v.null()),
    status: v.union(v.literal("pending_review"), v.literal("active"), v.literal("inactive")),
    confirmedMatchCount: v.number(),
    isVerified: v.boolean(),
    createdAt: v.number(),
});

const apprenticeSummaryValidator = v.object({
    id: v.id("apprentices"),
    phoneNumber: v.string(),
    locationText: v.string(),
    desiredCraft: v.string(),
    channel: v.union(v.literal("sms"), v.literal("ussd"), v.literal("admin")),
    status: v.union(v.literal("searching"), v.literal("matched"), v.literal("closed")),
    createdAt: v.number(),
});

const queuedMessageValidator = v.object({
    id: v.id("outboundMessages"),
    recipientPhone: v.string(),
    body: v.string(),
    provider: messageProviderValidator,
});

const countValidator = v.object({ label: v.string(), count: v.number() });

const VERIFICATION_THRESHOLD = 3;
const MAX_DELIVERY_ATTEMPTS = 5;
// Delay before asking both parties whether they actually connected.
const CONFIRMATION_DELAY_MS = 48 * 60 * 60 * 1000;

function nullableText(value: string): string | null {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function nonEmptyText(value: string, fallback: string): string {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : fallback;
}

function backoffDelayMs(failedAttempts: number): number {
    // Exponential backoff capped at ~15 minutes: 30s, 60s, 120s, ...
    return Math.min(15 * 60 * 1000, 30 * 1000 * 2 ** Math.max(0, failedAttempts - 1));
}

function isVerified(master: Doc<"masters">): boolean {
    return (master.confirmedMatchCount ?? 0) >= VERIFICATION_THRESHOLD;
}

function verificationBadge(master: Doc<"masters">): string {
    const confirmed = master.confirmedMatchCount ?? 0;
    if (isVerified(master)) return ` [Verified, ${confirmed} trained]`;
    if (confirmed > 0) return ` [${confirmed} trained]`;
    return "";
}

function incrementCounter(counters: Map<string, number>, key: string): void {
    counters.set(key, (counters.get(key) ?? 0) + 1);
}

function toCounts(counters: Map<string, number>): Array<{ label: string; count: number }> {
    return Array.from(counters.entries())
        .map(([label, count]) => ({ label, count }))
        .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
        .slice(0, 8);
}

function smsContact(master: Doc<"masters">): string {
    return master.phoneNumber ?? "phone pending";
}

function formatMastersForSms(masters: Array<Doc<"masters">>): string {
    if (masters.length === 0) {
        return "No matching Masters found yet. We will SMS you when one registers near you.";
    }

    const lines = masters.map(
        (master, index) =>
            `${index + 1}. ${master.name}${verificationBadge(master)} - ${master.craftText}, ${master.locationText}, ${smsContact(master)}`
    );
    return `Top Jua Kali matches:\n${lines.join("\n")}`;
}

async function getActiveSession(
    ctx: MutationCtx,
    phoneNumber: string,
    channel: "sms" | "ussd",
    now: number
): Promise<Doc<"interactionSessions"> | null> {
    const sessions = await ctx.db
        .query("interactionSessions")
        .withIndex("by_phoneNumber_and_channel", (q) => q.eq("phoneNumber", phoneNumber).eq("channel", channel))
        .order("desc")
        .take(5);
    return sessions.find((session) => session.state !== "completed" && session.expiresAt > now) ?? null;
}

async function findMatchingMasters(
    ctx: MutationCtx,
    craftKey: string,
    locationKey: string
): Promise<Array<Doc<"masters">>> {
    const exactMatches = await ctx.db
        .query("masters")
        .withIndex("by_status_and_craftKey_and_locationKey", (q) =>
            q.eq("status", "active").eq("craftKey", craftKey).eq("locationKey", locationKey)
        )
        .take(4);

    const craftMatches = await ctx.db
        .query("masters")
        .withIndex("by_status_and_craftKey", (q) => q.eq("status", "active").eq("craftKey", craftKey))
        .take(8);

    const byId = new Map<Id<"masters">, Doc<"masters">>();
    for (const master of [...exactMatches, ...craftMatches]) byId.set(master._id, master);

    return Array.from(byId.values())
        .sort(
            (left, right) =>
                scoreMaster(right.craftKey, right.locationKey, craftKey, locationKey) -
                scoreMaster(left.craftKey, left.locationKey, craftKey, locationKey)
        )
        .slice(0, 2);
}

async function upsertApprentice(
    ctx: MutationCtx,
    input: {
        phoneNumber: string;
        locationText: string;
        craftText: string;
        channel: "sms" | "ussd" | "admin";
        now: number;
    }
): Promise<Id<"apprentices">> {
    const existing = await ctx.db
        .query("apprentices")
        .withIndex("by_phoneNumber", (q) => q.eq("phoneNumber", input.phoneNumber))
        .first();
    const patch = {
        locationText: input.locationText,
        locationKey: normalizeKey(input.locationText),
        desiredCraft: input.craftText,
        craftKey: normalizeKey(input.craftText),
        channel: input.channel,
        status: "searching" as const,
        updatedAt: input.now,
    };

    if (existing) {
        await ctx.db.patch(existing._id, patch);
        return existing._id;
    }

    return await ctx.db.insert("apprentices", {
        phoneNumber: input.phoneNumber,
        ...patch,
        createdAt: input.now,
    });
}

async function recordOutboundMessage(
    ctx: MutationCtx,
    input: {
        recipientPhone: string;
        body: string;
        provider: "twilio" | "africas_talking" | "mock";
        messageType: "welcome" | "interview_reply" | "master_alert" | "confirmation_prompt";
        relatedMasterId: Id<"masters"> | null;
        relatedApprenticeId: Id<"apprentices"> | null;
        relatedMatchRequestId: Id<"matchRequests"> | null;
        relatedMatchId?: Id<"matches"> | null;
        now: number;
    }
): Promise<Id<"outboundMessages">> {
    return await ctx.db.insert("outboundMessages", {
        recipientPhone: input.recipientPhone,
        body: input.body,
        channel: "sms",
        provider: input.provider,
        providerStatus: "queued",
        messageType: input.messageType,
        providerMessageId: null,
        failedAttempts: 0,
        nextAttemptAt: input.now,
        relatedMasterId: input.relatedMasterId,
        relatedApprenticeId: input.relatedApprenticeId,
        relatedMatchRequestId: input.relatedMatchRequestId,
        relatedMatchId: input.relatedMatchId ?? null,
        createdAt: input.now,
        sentAt: null,
        lastError: null,
    });
}

async function createMatchAndMessages(
    ctx: MutationCtx,
    input: {
        phoneNumber: string;
        locationText: string;
        craftText: string;
        channel: "sms" | "ussd" | "admin";
        provider: "twilio" | "africas_talking" | "mock";
        now: number;
    }
): Promise<{ reply: string; outboundMessageId: Id<"outboundMessages">; requestId: Id<"matchRequests"> }> {
    const apprenticeId = await upsertApprentice(ctx, input);
    const locationKey = normalizeKey(input.locationText);
    const craftKey = normalizeKey(input.craftText);
    const requestId = await ctx.db.insert("matchRequests", {
        apprenticeId,
        apprenticePhone: input.phoneNumber,
        locationText: input.locationText,
        locationKey,
        craftText: input.craftText,
        craftKey,
        channel: input.channel,
        status: "completed",
        createdAt: input.now,
        completedAt: input.now,
    });

    const masters = await findMatchingMasters(ctx, craftKey, locationKey);
    const reply = formatMastersForSms(masters);
    const outboundMessageId = await recordOutboundMessage(ctx, {
        recipientPhone: input.phoneNumber,
        body: reply,
        provider: input.provider,
        messageType: "interview_reply",
        relatedApprenticeId: apprenticeId,
        relatedMasterId: null,
        relatedMatchRequestId: requestId,
        now: input.now,
    });

    for (const master of masters) {
        const matchId = await ctx.db.insert("matches", {
            matchRequestId: requestId,
            apprenticeId,
            apprenticePhone: input.phoneNumber,
            masterId: master._id,
            score: scoreMaster(master.craftKey, master.locationKey, craftKey, locationKey),
            status: "proposed",
            confirmationState: "awaiting",
            confirmationPromptSentAt: null,
            confirmationResolvedAt: null,
            createdAt: input.now,
            apprenticeNotifiedAt: input.now,
            masterNotifiedAt: master.phoneNumber ? input.now : null,
        });

        if (master.phoneNumber) {
            await recordOutboundMessage(ctx, {
                recipientPhone: master.phoneNumber,
                body: `Jua Kali alert: An apprentice near ${input.locationText} wants to learn ${input.craftText}. Apprentice phone: ${input.phoneNumber}`,
                provider: input.provider,
                messageType: "master_alert",
                relatedApprenticeId: apprenticeId,
                relatedMasterId: master._id,
                relatedMatchRequestId: requestId,
                relatedMatchId: matchId,
                now: input.now,
            });
        }
    }

    await ctx.db.patch(apprenticeId, { status: masters.length > 0 ? "matched" : "searching", updatedAt: input.now });
    return { reply, outboundMessageId, requestId };
}

// Resolves a "Did you connect? 1=Yes 2=No" reply against the apprentice's oldest awaiting match.
async function resolvePendingConfirmation(
    ctx: MutationCtx,
    phoneNumber: string,
    body: string,
    now: number
): Promise<string | null> {
    const normalized = body.trim().toLowerCase();
    const isYes = normalized === "1" || normalized === "ndio" || normalized === "yes";
    const isNo = normalized === "2" || normalized === "hapana" || normalized === "no";
    if (!isYes && !isNo) return null;

    const pending = await ctx.db
        .query("matches")
        .withIndex("by_apprenticePhone_and_confirmationState", (q) =>
            q.eq("apprenticePhone", phoneNumber).eq("confirmationState", "awaiting")
        )
        .order("asc")
        .first();
    // Only treat as a confirmation if a prompt was actually sent for this match.
    if (!pending || !pending.confirmationPromptSentAt) return null;

    await ctx.db.patch(pending._id, {
        confirmationState: isYes ? "confirmed" : "denied",
        status: isYes ? "accepted" : "declined",
        confirmationResolvedAt: now,
    });

    const master = await ctx.db.get(pending.masterId);
    if (master) {
        if (isYes) {
            await ctx.db.patch(master._id, {
                confirmedMatchCount: (master.confirmedMatchCount ?? 0) + 1,
                updatedAt: now,
            });
        } else {
            await ctx.db.patch(master._id, {
                deniedMatchCount: (master.deniedMatchCount ?? 0) + 1,
                updatedAt: now,
            });
        }
    }

    return isYes
        ? "Asante! Tumefurahi ulipata fundi. Karibu tena Jua Kali Matcher."
        : "Asante kwa kujibu. Tutakutafutia fundi mwingine. Reply CHUKUA to try again.";
}

// Internal: queue confirmation-prompt SMS for matured matches.
export const queueConfirmationPrompts = internalMutation({
    args: {},
    returns: v.object({ queued: v.number() }),
    handler: async (ctx) => {
        const now = Date.now();
        const due = await ctx.db
            .query("matches")
            .withIndex("by_status_and_confirmationState", (q) =>
                q.eq("status", "proposed").eq("confirmationState", "awaiting")
            )
            .order("asc")
            .take(50);

        let queued = 0;
        for (const match of due) {
            if (match.confirmationPromptSentAt) continue;
            if (now - match.createdAt < CONFIRMATION_DELAY_MS) continue;
            const phone = match.apprenticePhone;
            if (!phone) {
                await ctx.db.patch(match._id, { confirmationPromptSentAt: now });
                continue;
            }
            const master = await ctx.db.get(match.masterId);
            const masterName = master?.name ?? "the master";
            await recordOutboundMessage(ctx, {
                recipientPhone: phone,
                body: `Jua Kali: Did you connect with ${masterName}? Reply 1=Yes 2=No`,
                provider: "mock",
                messageType: "confirmation_prompt",
                relatedApprenticeId: match.apprenticeId,
                relatedMasterId: match.masterId,
                relatedMatchRequestId: match.matchRequestId,
                relatedMatchId: match._id,
                now,
            });
            await ctx.db.patch(match._id, { confirmationPromptSentAt: now });
            queued += 1;
        }
        return { queued };
    },
});

export const getVoiceIntakeForProcessing = internalQuery({
    args: { voiceIntakeId: v.id("voiceIntakes") },
    returns: v.union(
        v.object({
            _id: v.id("voiceIntakes"),
            fromPhone: v.union(v.string(), v.null()),
            recordingUrl: v.union(v.string(), v.null()),
            transcript: v.union(v.string(), v.null()),
        }),
        v.null()
    ),
    handler: async (ctx, args) => {
        const intake = await ctx.db.get(args.voiceIntakeId);
        if (!intake) return null;
        return {
            _id: intake._id,
            fromPhone: intake.fromPhone,
            recordingUrl: intake.recordingUrl,
            transcript: intake.transcript,
        };
    },
});

export const recordVoiceWebhook = internalMutation({
    args: {
        fromPhone: v.string(),
        callSid: v.string(),
        recordingUrl: v.string(),
        transcriptHint: v.string(),
        provider: messageProviderValidator,
        rawPayload: v.string(),
    },
    returns: v.id("voiceIntakes"),
    handler: async (ctx, args) => {
        const now = Date.now();
        return await ctx.db.insert("voiceIntakes", {
            fromPhone: nullableText(args.fromPhone) ? normalizePhone(args.fromPhone) : null,
            callSid: nullableText(args.callSid),
            recordingUrl: nullableText(args.recordingUrl),
            provider: args.provider,
            rawPayload: args.rawPayload,
            transcript: nullableText(args.transcriptHint),
            processingStatus: "queued",
            errorMessage: null,
            extractedName: null,
            extractedLocationText: null,
            extractedCraftText: null,
            extractedKeySkills: [],
            masterId: null,
            createdAt: now,
            updatedAt: now,
        });
    },
});

export const completeVoiceIntake = internalMutation({
    args: {
        voiceIntakeId: v.id("voiceIntakes"),
        transcript: v.string(),
        name: v.string(),
        locationText: v.string(),
        craftText: v.string(),
        keySkills: v.array(v.string()),
        profileSummary: v.string(),
        language: languageValidator,
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const intake = await ctx.db.get(args.voiceIntakeId);
        if (!intake) throw new Error("Voice intake not found");
        const now = Date.now();
        const locationText = nonEmptyText(args.locationText, "Unknown location");
        const craftText = nonEmptyText(args.craftText, "General artisan skills");
        const masterId = await ctx.db.insert("masters", {
            name: nonEmptyText(args.name, intake.fromPhone ?? "Unnamed Master"),
            phoneNumber: intake.fromPhone,
            locationText,
            locationKey: normalizeKey(locationText),
            craftText,
            craftKey: normalizeKey(craftText),
            keySkills: args.keySkills.slice(0, 6),
            profileSummary: nonEmptyText(args.profileSummary, args.transcript.slice(0, 280)),
            transcript: args.transcript,
            originalAudioUrl: intake.recordingUrl,
            language: args.language,
            status: "active",
            source: "voice",
            voiceIntakeId: args.voiceIntakeId,
            createdAt: now,
            updatedAt: now,
        });

        await ctx.db.patch(args.voiceIntakeId, {
            transcript: args.transcript,
            processingStatus: "processed",
            errorMessage: null,
            extractedName: args.name,
            extractedLocationText: locationText,
            extractedCraftText: craftText,
            extractedKeySkills: args.keySkills.slice(0, 6),
            masterId,
            updatedAt: now,
        });
        return null;
    },
});

export const markVoiceIntakeFailed = internalMutation({
    args: { voiceIntakeId: v.id("voiceIntakes"), errorMessage: v.string() },
    returns: v.null(),
    handler: async (ctx, args) => {
        await ctx.db.patch(args.voiceIntakeId, {
            processingStatus: "failed",
            errorMessage: args.errorMessage,
            updatedAt: Date.now(),
        });
        return null;
    },
});

export const queuedSmsForDelivery = internalQuery({
    args: { limit: v.number() },
    returns: v.array(queuedMessageValidator),
    handler: async (ctx, args) => {
        const now = Date.now();
        const rows = await ctx.db
            .query("outboundMessages")
            .withIndex("by_providerStatus", (q) => q.eq("providerStatus", "queued"))
            .order("asc")
            .take(Math.max(1, Math.min(50, args.limit * 3)));
        return rows
            .filter((row) => (row.nextAttemptAt ?? 0) <= now)
            .slice(0, Math.max(1, Math.min(25, args.limit)))
            .map((row) => ({
                id: row._id,
                recipientPhone: row.recipientPhone,
                body: row.body,
                provider: row.provider,
            }));
    },
});

export const markOutboundSent = internalMutation({
    args: { outboundMessageId: v.id("outboundMessages"), providerMessageId: v.string() },
    returns: v.null(),
    handler: async (ctx, args) => {
        await ctx.db.patch(args.outboundMessageId, {
            providerStatus: "sent",
            providerMessageId: args.providerMessageId,
            sentAt: Date.now(),
            lastError: null,
        });
        return null;
    },
});

export const markOutboundFailed = internalMutation({
    args: { outboundMessageId: v.id("outboundMessages"), errorMessage: v.string() },
    returns: v.null(),
    handler: async (ctx, args) => {
        const message = await ctx.db.get(args.outboundMessageId);
        if (!message) return null;
        const now = Date.now();
        const failedAttempts = (message.failedAttempts ?? 0) + 1;
        if (failedAttempts >= MAX_DELIVERY_ATTEMPTS) {
            // Dead-letter: stop retrying after the cap so a bad number can't loop forever.
            await ctx.db.patch(args.outboundMessageId, {
                providerStatus: "dead_letter",
                failedAttempts,
                lastError: args.errorMessage,
            });
            return null;
        }
        await ctx.db.patch(args.outboundMessageId, {
            providerStatus: "queued",
            failedAttempts,
            nextAttemptAt: now + backoffDelayMs(failedAttempts),
            lastError: args.errorMessage,
        });
        return null;
    },
});

export const handleSmsWebhook = internalMutation({
    args: {
        fromPhone: v.string(),
        body: v.string(),
        provider: messageProviderValidator,
        rawPayload: v.string(),
        idempotencyKey: v.union(v.string(), v.null()),
    },
    returns: v.object({
        reply: v.string(),
        outboundMessageId: v.union(v.id("outboundMessages"), v.null()),
    }),
    handler: async (ctx, args) => {
        const now = Date.now();

        // Idempotency: providers retry on timeout; dedupe by provider message SID.
        if (args.idempotencyKey) {
            const seen = await ctx.db
                .query("processedWebhooks")
                .withIndex("by_key", (q) => q.eq("key", args.idempotencyKey as string))
                .first();
            if (seen) return { reply: seen.reply, outboundMessageId: null };
        }

        const phoneNumber = normalizePhone(args.fromPhone);
        const body = args.body.trim();
        await ctx.db.insert("inboundMessages", {
            fromPhone: phoneNumber,
            body,
            channel: "sms",
            provider: args.provider,
            rawPayload: args.rawPayload,
            createdAt: now,
        });

        const finish = async (reply: string, outboundMessageId: Id<"outboundMessages"> | null) => {
            if (args.idempotencyKey) {
                await ctx.db.insert("processedWebhooks", {
                    key: args.idempotencyKey,
                    channel: "sms",
                    reply,
                    createdAt: now,
                });
            }
            return { reply, outboundMessageId };
        };

        // Confirmation-loop reply: "1" = connected, "2" = did not connect.
        const confirmationReply = await resolvePendingConfirmation(ctx, phoneNumber, body, now);
        if (confirmationReply) {
            const outboundMessageId = await recordOutboundMessage(ctx, {
                recipientPhone: phoneNumber,
                body: confirmationReply,
                provider: args.provider,
                messageType: "interview_reply",
                relatedApprenticeId: null,
                relatedMasterId: null,
                relatedMatchRequestId: null,
                now,
            });
            return await finish(confirmationReply, outboundMessageId);
        }

        const session = await getActiveSession(ctx, phoneNumber, "sms", now);
        if (!session || /^chukua$/i.test(body) || /^start$/i.test(body)) {
            await ctx.db.insert("interactionSessions", {
                sessionId: `sms:${phoneNumber}:${now}`,
                phoneNumber,
                channel: "sms",
                state: "awaiting_location",
                locationText: null,
                locationKey: null,
                craftText: null,
                craftKey: null,
                createdAt: now,
                updatedAt: now,
                expiresAt: now + 30 * 60 * 1000,
            });
            const reply = "Karibu Jua Kali Matcher. Reply with your town/location (e.g. Kibera, Thika, Kisumu).";
            const outboundMessageId = await recordOutboundMessage(ctx, {
                recipientPhone: phoneNumber,
                body: reply,
                provider: args.provider,
                messageType: "welcome",
                relatedApprenticeId: null,
                relatedMasterId: null,
                relatedMatchRequestId: null,
                now,
            });
            return await finish(reply, outboundMessageId);
        }

        if (session.state === "awaiting_location") {
            await ctx.db.patch(session._id, {
                state: "awaiting_craft",
                locationText: body,
                locationKey: normalizeKey(body),
                updatedAt: now,
                expiresAt: now + 30 * 60 * 1000,
            });
            const reply = "Asante. Reply with the craft you want to learn (e.g. welding, carpentry, tailoring).";
            const outboundMessageId = await recordOutboundMessage(ctx, {
                recipientPhone: phoneNumber,
                body: reply,
                provider: args.provider,
                messageType: "welcome",
                relatedApprenticeId: null,
                relatedMasterId: null,
                relatedMatchRequestId: null,
                now,
            });
            return await finish(reply, outboundMessageId);
        }

        const locationText = session.locationText ?? "Unknown location";
        const result = await createMatchAndMessages(ctx, {
            phoneNumber,
            locationText,
            craftText: body,
            channel: "sms",
            provider: args.provider,
            now,
        });
        await ctx.db.patch(session._id, {
            state: "completed",
            craftText: body,
            craftKey: normalizeKey(body),
            updatedAt: now,
        });
        return await finish(result.reply, result.outboundMessageId);
    },
});

export const handleUssdWebhook = internalMutation({
    args: {
        sessionId: v.string(),
        serviceCode: v.string(),
        phoneNumber: v.string(),
        text: v.string(),
        provider: messageProviderValidator,
        rawPayload: v.string(),
    },
    returns: v.string(),
    handler: async (ctx, args) => {
        const now = Date.now();
        const phoneNumber = normalizePhone(args.phoneNumber);
        const segments = args.text
            .split("*")
            .map((segment) => segment.trim())
            .filter((segment) => segment.length > 0);

        const existing = await ctx.db
            .query("interactionSessions")
            .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
            .first();

        if (segments.length === 0) {
            if (!existing) {
                await ctx.db.insert("interactionSessions", {
                    sessionId: args.sessionId,
                    phoneNumber,
                    channel: "ussd",
                    state: "awaiting_location",
                    locationText: null,
                    locationKey: null,
                    craftText: null,
                    craftKey: null,
                    createdAt: now,
                    updatedAt: now,
                    expiresAt: now + 10 * 60 * 1000,
                });
            }
            return "CON Welcome to Jua Kali Matcher\nEnter your town/location:";
        }

        if (segments.length === 1) {
            if (existing) {
                await ctx.db.patch(existing._id, {
                    state: "awaiting_craft",
                    locationText: segments[0],
                    locationKey: normalizeKey(segments[0]),
                    updatedAt: now,
                    expiresAt: now + 10 * 60 * 1000,
                });
            }
            return "CON Enter craft you want to learn:\n1. Welding\n2. Carpentry\n3. Tailoring\nOr type another craft";
        }

        const craftByMenu: Record<string, string> = {
            "1": "welding",
            "2": "carpentry",
            "3": "tailoring",
        };
        const craftText = craftByMenu[segments[1]] ?? segments[1];
        const result = await createMatchAndMessages(ctx, {
            phoneNumber,
            locationText: segments[0],
            craftText,
            channel: "ussd",
            provider: args.provider,
            now,
        });

        if (existing) {
            await ctx.db.patch(existing._id, {
                state: "completed",
                craftText,
                craftKey: normalizeKey(craftText),
                updatedAt: now,
            });
        }

        return `END ${result.reply}`;
    },
});

export const seedDemoData = mutation({
    args: {},
    returns: v.object({
        createdMasters: v.number(),
        createdMatches: v.number(),
        message: v.string(),
    }),
    handler: async (ctx) => {
        const now = Date.now();
        const existingMasters = await ctx.db.query("masters").order("desc").take(100);
        const existingSeedNames = new Set(existingMasters.filter((master) => master.source === "seed").map((master) => master.name));
        const seedMasters = [
            {
                name: "Asha Njeri",
                phoneNumber: "+254711000101",
                locationText: "Kariobangi",
                craftText: "Metalwork",
                keySkills: ["gate fabrication", "welding safety", "sheet metal cutting", "finishing"],
                profileSummary: "Twenty years in Kariobangi light engineering, training youth on welding, metal gates, and practical workshop safety.",
            },
            {
                name: "Moses Otieno",
                phoneNumber: "+254711000202",
                locationText: "Kisumu",
                craftText: "Carpentry",
                keySkills: ["cabinet making", "timber selection", "joinery", "tool care"],
                profileSummary: "Furniture maker near Kondele with a small workshop focused on cabinets, beds, repair work, and disciplined tool handling.",
            },
            {
                name: "Fatuma Ali",
                phoneNumber: "+254711000303",
                locationText: "Mombasa",
                craftText: "Tailoring",
                keySkills: ["pattern cutting", "school uniforms", "machine maintenance", "finishing"],
                profileSummary: "Tailor in Majengo teaching garment construction, measurements, customer handling, and machine upkeep.",
            },
            {
                name: "Peter Mwangi",
                phoneNumber: "+254711000404",
                locationText: "Thika",
                craftText: "Mechanics",
                keySkills: ["motorbike repair", "diagnostics", "engine servicing", "parts sourcing"],
                profileSummary: "Motorbike mechanic on Garissa Road supporting apprentices with hands-on diagnostics, servicing, and spare-parts sourcing.",
            },
        ];

        let createdMasters = 0;
        for (const master of seedMasters) {
            if (existingSeedNames.has(master.name)) continue;
            await ctx.db.insert("masters", {
                name: master.name,
                phoneNumber: master.phoneNumber,
                locationText: master.locationText,
                locationKey: normalizeKey(master.locationText),
                craftText: master.craftText,
                craftKey: normalizeKey(master.craftText),
                keySkills: master.keySkills,
                profileSummary: master.profileSummary,
                transcript: `Seed transcript: ${master.name} from ${master.locationText} teaches ${master.craftText}.`,
                originalAudioUrl: null,
                language: "mixed",
                status: "active",
                source: "seed",
                voiceIntakeId: null,
                createdAt: now + createdMasters,
                updatedAt: now + createdMasters,
            });
            createdMasters += 1;
        }

        const existingSeedApprentice = await ctx.db
            .query("apprentices")
            .withIndex("by_phoneNumber", (q) => q.eq("phoneNumber", "+254722000505"))
            .first();

        let createdMatches = 0;
        if (!existingSeedApprentice) {
            const result = await createMatchAndMessages(ctx, {
                phoneNumber: "+254722000505",
                locationText: "Kariobangi",
                craftText: "Metalwork",
                channel: "sms",
                provider: "mock",
                now: now + 10,
            });
            const matches = await ctx.db
                .query("matches")
                .withIndex("by_matchRequestId", (q) => q.eq("matchRequestId", result.requestId))
                .take(5);
            createdMatches = matches.length;
        }

        return {
            createdMasters,
            createdMatches,
            message: createdMasters === 0 && createdMatches === 0 ? "Demo data already exists" : "Demo data seeded",
        };
    },
});

export const runApprenticeInterview = mutation({
    args: {
        phoneNumber: v.string(),
        locationText: v.string(),
        craftText: v.string(),
    },
    returns: v.object({
        requestId: v.id("matchRequests"),
        reply: v.string(),
        matches: v.array(
            v.object({
                id: v.id("masters"),
                name: v.string(),
                locationText: v.string(),
                craftText: v.string(),
                keySkills: v.array(v.string()),
                profileSummary: v.string(),
                phoneNumber: v.union(v.string(), v.null()),
                score: v.number(),
            })
        ),
    }),
    handler: async (ctx, args) => {
        const trimmedPhone = args.phoneNumber.trim();
        const phoneNumber = trimmedPhone.length > 0 ? normalizePhone(trimmedPhone) : `+254700${String(Math.floor(100000 + Math.random() * 899999))}`;
        const locationText = args.locationText.trim();
        const craftText = args.craftText.trim();
        if (locationText.length === 0) throw new Error("Location is required");
        if (craftText.length === 0) throw new Error("Craft is required");

        const now = Date.now();
        const result = await createMatchAndMessages(ctx, {
            phoneNumber,
            locationText,
            craftText,
            channel: "admin",
            provider: "mock",
            now,
        });

        const matchRows = await ctx.db
            .query("matches")
            .withIndex("by_matchRequestId", (q) => q.eq("matchRequestId", result.requestId))
            .take(5);

        const matches = [];
        for (const row of matchRows) {
            const master = await ctx.db.get(row.masterId);
            if (!master) continue;
            matches.push({
                id: master._id,
                name: master.name,
                locationText: master.locationText,
                craftText: master.craftText,
                keySkills: master.keySkills,
                profileSummary: master.profileSummary,
                phoneNumber: master.phoneNumber,
                score: row.score,
            });
        }
        matches.sort((left, right) => right.score - left.score);

        return { requestId: result.requestId, reply: result.reply, matches };
    },
});

export const dashboardData = query({
    args: {},
    returns: v.object({
        masters: v.array(masterSummaryValidator),
        apprentices: v.array(apprenticeSummaryValidator),
        voiceIntakes: v.array(
            v.object({
                id: v.id("voiceIntakes"),
                fromPhone: v.union(v.string(), v.null()),
                recordingUrl: v.union(v.string(), v.null()),
                transcript: v.union(v.string(), v.null()),
                processingStatus: v.union(v.literal("queued"), v.literal("processed"), v.literal("failed")),
                errorMessage: v.union(v.string(), v.null()),
                extractedName: v.union(v.string(), v.null()),
                extractedLocationText: v.union(v.string(), v.null()),
                extractedCraftText: v.union(v.string(), v.null()),
                createdAt: v.number(),
            })
        ),
        recentMatches: v.array(
            v.object({
                id: v.id("matches"),
                masterName: v.string(),
                apprenticePhone: v.string(),
                craftText: v.string(),
                locationText: v.string(),
                score: v.number(),
                createdAt: v.number(),
            })
        ),
        outboundMessages: v.array(
            v.object({
                id: v.id("outboundMessages"),
                recipientPhone: v.string(),
                body: v.string(),
                providerStatus: v.union(
                    v.literal("queued"),
                    v.literal("sent"),
                    v.literal("failed"),
                    v.literal("dead_letter")
                ),
                createdAt: v.number(),
            })
        ),
        analytics: v.object({
            totalMasters: v.number(),
            totalApprentices: v.number(),
            totalMatches: v.number(),
            queuedSms: v.number(),
            verifiedMasters: v.number(),
            confirmedConnections: v.number(),
            awaitingConfirmation: v.number(),
            mastersByCraft: v.array(countValidator),
            apprenticesByCraft: v.array(countValidator),
            signupsByLocation: v.array(countValidator),
        }),
    }),
    handler: async (ctx) => {
        const masters = await ctx.db.query("masters").order("desc").take(100);
        const apprentices = await ctx.db.query("apprentices").order("desc").take(100);
        const voiceRows = await ctx.db.query("voiceIntakes").order("desc").take(12);
        const matchRows = await ctx.db.query("matches").order("desc").take(30);
        const outboundRows = await ctx.db.query("outboundMessages").order("desc").take(30);

        const mastersByCraft = new Map<string, number>();
        const apprenticesByCraft = new Map<string, number>();
        const signupsByLocation = new Map<string, number>();
        for (const master of masters) {
            incrementCounter(mastersByCraft, master.craftText);
            incrementCounter(signupsByLocation, master.locationText);
        }
        for (const apprentice of apprentices) {
            incrementCounter(apprenticesByCraft, apprentice.desiredCraft);
            incrementCounter(signupsByLocation, apprentice.locationText);
        }

        const recentMatches = [];
        for (const match of matchRows.slice(0, 12)) {
            const master = await ctx.db.get(match.masterId);
            const request = await ctx.db.get(match.matchRequestId);
            if (master && request) {
                recentMatches.push({
                    id: match._id,
                    masterName: master.name,
                    apprenticePhone: request.apprenticePhone,
                    craftText: request.craftText,
                    locationText: request.locationText,
                    score: match.score,
                    createdAt: match.createdAt,
                });
            }
        }

        return {
            masters: masters.slice(0, 12).map((master) => ({
                id: master._id,
                name: master.name,
                phoneNumber: master.phoneNumber,
                locationText: master.locationText,
                craftText: master.craftText,
                keySkills: master.keySkills,
                profileSummary: master.profileSummary,
                transcript: master.transcript,
                originalAudioUrl: master.originalAudioUrl,
                status: master.status,
                confirmedMatchCount: master.confirmedMatchCount ?? 0,
                isVerified: (master.confirmedMatchCount ?? 0) >= VERIFICATION_THRESHOLD,
                createdAt: master.createdAt,
            })),
            apprentices: apprentices.slice(0, 12).map((apprentice) => ({
                id: apprentice._id,
                phoneNumber: apprentice.phoneNumber,
                locationText: apprentice.locationText,
                desiredCraft: apprentice.desiredCraft,
                channel: apprentice.channel,
                status: apprentice.status,
                createdAt: apprentice.createdAt,
            })),
            voiceIntakes: voiceRows.map((intake) => ({
                id: intake._id,
                fromPhone: intake.fromPhone,
                recordingUrl: intake.recordingUrl,
                transcript: intake.transcript,
                processingStatus: intake.processingStatus,
                errorMessage: intake.errorMessage,
                extractedName: intake.extractedName,
                extractedLocationText: intake.extractedLocationText,
                extractedCraftText: intake.extractedCraftText,
                createdAt: intake.createdAt,
            })),
            recentMatches,
            outboundMessages: outboundRows.slice(0, 12).map((message) => ({
                id: message._id,
                recipientPhone: message.recipientPhone,
                body: message.body,
                providerStatus: message.providerStatus,
                createdAt: message.createdAt,
            })),
            analytics: {
                totalMasters: masters.length,
                totalApprentices: apprentices.length,
                totalMatches: matchRows.length,
                queuedSms: outboundRows.filter((message) => message.providerStatus === "queued").length,
                verifiedMasters: masters.filter((master) => (master.confirmedMatchCount ?? 0) >= VERIFICATION_THRESHOLD).length,
                confirmedConnections: matchRows.filter((match) => match.confirmationState === "confirmed").length,
                awaitingConfirmation: matchRows.filter((match) => match.confirmationState === "awaiting").length,
                mastersByCraft: toCounts(mastersByCraft),
                apprenticesByCraft: toCounts(apprenticesByCraft),
                signupsByLocation: toCounts(signupsByLocation),
            },
        };
    },
});

export const registerMasterViaMcp = mutation({
    args: {
        name: v.string(),
        phoneNumber: v.union(v.string(), v.null()),
        locationText: v.string(),
        craftText: v.string(),
        keySkills: v.array(v.string()),
        profileSummary: v.string(),
        language: languageValidator,
        transcript: v.union(v.string(), v.null()),
    },
    returns: v.object({ masterId: v.id("masters"), message: v.string() }),
    handler: async (ctx, args) => {
        const now = Date.now();
        const locationText = nonEmptyText(args.locationText, "Unknown location");
        const craftText = nonEmptyText(args.craftText, "General artisan skills");
        const masterId = await ctx.db.insert("masters", {
            name: nonEmptyText(args.name, "Unnamed Master"),
            phoneNumber: args.phoneNumber,
            locationText,
            locationKey: normalizeKey(locationText),
            craftText,
            craftKey: normalizeKey(craftText),
            keySkills: args.keySkills.slice(0, 6),
            profileSummary: nonEmptyText(args.profileSummary, ""),
            transcript: args.transcript,
            originalAudioUrl: null,
            language: args.language,
            status: "active",
            source: "admin",
            voiceIntakeId: null,
            createdAt: now,
            updatedAt: now,
        });
        return { masterId, message: `Master "${args.name}" registered successfully.` };
    },
});

export const queueSmsViaMcp = mutation({
    args: {
        recipientPhone: v.string(),
        body: v.string(),
    },
    returns: v.object({ messageId: v.id("outboundMessages"), status: v.string() }),
    handler: async (ctx, args) => {
        const now = Date.now();
        const messageId = await recordOutboundMessage(ctx, {
            recipientPhone: normalizePhone(args.recipientPhone),
            body: args.body,
            provider: "mock",
            messageType: "interview_reply",
            relatedMasterId: null,
            relatedApprenticeId: null,
            relatedMatchRequestId: null,
            now,
        });
        return { messageId, status: "queued" };
    },
});

export const confirmMatchViaMcp = mutation({
    args: {
        matchId: v.id("matches"),
        connected: v.boolean(),
    },
    returns: v.object({ message: v.string() }),
    handler: async (ctx, args) => {
        const now = Date.now();
        const match = await ctx.db.get(args.matchId);
        if (!match) throw new Error("Match not found");

        await ctx.db.patch(match._id, {
            confirmationState: args.connected ? "confirmed" : "denied",
            status: args.connected ? "accepted" : "declined",
            confirmationResolvedAt: now,
        });

        const master = await ctx.db.get(match.masterId);
        if (master) {
            if (args.connected) {
                await ctx.db.patch(master._id, {
                    confirmedMatchCount: (master.confirmedMatchCount ?? 0) + 1,
                    updatedAt: now,
                });
            } else {
                await ctx.db.patch(master._id, {
                    deniedMatchCount: (master.deniedMatchCount ?? 0) + 1,
                    updatedAt: now,
                });
            }
        }

        const masterName = master?.name ?? "the master";
        return {
            message: args.connected
                ? `Match confirmed: apprentice connected with ${masterName}.`
                : `Match denied: apprentice did not connect with ${masterName}.`,
        };
    },
});
