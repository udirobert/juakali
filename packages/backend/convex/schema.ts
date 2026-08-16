import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

const language = v.union(v.literal("sw"), v.literal("en"), v.literal("mixed"), v.literal("unknown"));
const telephonyProvider = v.union(v.literal("twilio"), v.literal("africas_talking"), v.literal("mock"));
const smsChannel = v.union(v.literal("sms"), v.literal("ussd"));
const confirmationState = v.union(v.literal("awaiting"), v.literal("confirmed"), v.literal("denied"));
const outboundMessageType = v.union(
    v.literal("welcome"),
    v.literal("interview_reply"),
    v.literal("master_alert"),
    v.literal("confirmation_prompt"),
    v.literal("digest"),
    v.literal("kpi_prompt")
);

const kpiUnit = v.union(v.literal("meetings"), v.literal("revenue_kes"), v.literal("jobs"));
const commitmentStatus = v.union(
    v.literal("pledged"),
    v.literal("active"),
    v.literal("completed"),
    v.literal("written_off")
);
const kpiSource = v.union(
    v.literal("agent"),
    v.literal("sms"),
    v.literal("manual"),
    v.literal("email_paste")
);
const ledgerEventType = v.union(
    v.literal("pledge"),
    v.literal("checkin"),
    v.literal("digest"),
    v.literal("action")
);

export default defineSchema({
    ...authTables,

    masters: defineTable({
        name: v.string(),
        phoneNumber: v.union(v.string(), v.null()),
        locationText: v.string(),
        locationKey: v.string(),
        craftText: v.string(),
        craftKey: v.string(),
        keySkills: v.array(v.string()),
        profileSummary: v.string(),
        transcript: v.union(v.string(), v.null()),
        originalAudioUrl: v.union(v.string(), v.null()),
        language,
        status: v.union(v.literal("pending_review"), v.literal("active"), v.literal("inactive")),
        source: v.union(v.literal("voice"), v.literal("admin"), v.literal("seed")),
        voiceIntakeId: v.union(v.id("voiceIntakes"), v.null()),
        // Reputation: number of apprentice-confirmed successful connections.
        confirmedMatchCount: v.optional(v.number()),
        deniedMatchCount: v.optional(v.number()),
        createdAt: v.number(),
        updatedAt: v.number(),
    })
        .index("by_status", ["status"])
        .index("by_locationKey", ["locationKey"])
        .index("by_craftKey", ["craftKey"])
        .index("by_status_and_craftKey", ["status", "craftKey"])
        .index("by_status_and_craftKey_and_locationKey", ["status", "craftKey", "locationKey"]),

    voiceIntakes: defineTable({
        fromPhone: v.union(v.string(), v.null()),
        callSid: v.union(v.string(), v.null()),
        recordingUrl: v.union(v.string(), v.null()),
        provider: telephonyProvider,
        rawPayload: v.string(),
        transcript: v.union(v.string(), v.null()),
        processingStatus: v.union(v.literal("queued"), v.literal("processed"), v.literal("failed")),
        errorMessage: v.union(v.string(), v.null()),
        extractedName: v.union(v.string(), v.null()),
        extractedLocationText: v.union(v.string(), v.null()),
        extractedCraftText: v.union(v.string(), v.null()),
        extractedKeySkills: v.array(v.string()),
        masterId: v.union(v.id("masters"), v.null()),
        createdAt: v.number(),
        updatedAt: v.number(),
    })
        .index("by_fromPhone", ["fromPhone"])
        .index("by_processingStatus", ["processingStatus"]),

    apprentices: defineTable({
        phoneNumber: v.string(),
        locationText: v.string(),
        locationKey: v.string(),
        desiredCraft: v.string(),
        craftKey: v.string(),
        channel: v.union(v.literal("sms"), v.literal("ussd"), v.literal("admin")),
        status: v.union(v.literal("searching"), v.literal("matched"), v.literal("closed")),
        createdAt: v.number(),
        updatedAt: v.number(),
    })
        .index("by_phoneNumber", ["phoneNumber"])
        .index("by_locationKey", ["locationKey"])
        .index("by_craftKey", ["craftKey"])
        .index("by_craftKey_and_locationKey", ["craftKey", "locationKey"]),

    matchRequests: defineTable({
        apprenticeId: v.id("apprentices"),
        apprenticePhone: v.string(),
        locationText: v.string(),
        locationKey: v.string(),
        craftText: v.string(),
        craftKey: v.string(),
        channel: v.union(v.literal("sms"), v.literal("ussd"), v.literal("admin")),
        status: v.union(v.literal("pending"), v.literal("completed"), v.literal("no_match")),
        createdAt: v.number(),
        completedAt: v.union(v.number(), v.null()),
    })
        .index("by_apprenticeId", ["apprenticeId"])
        .index("by_craftKey_and_locationKey", ["craftKey", "locationKey"])
        .index("by_status", ["status"]),

    matches: defineTable({
        matchRequestId: v.id("matchRequests"),
        apprenticeId: v.id("apprentices"),
        apprenticePhone: v.optional(v.string()),
        masterId: v.id("masters"),
        score: v.number(),
        status: v.union(v.literal("proposed"), v.literal("accepted"), v.literal("declined"), v.literal("expired")),
        // Post-match confirmation loop: "Did you connect? 1=Yes 2=No".
        confirmationState: v.optional(confirmationState),
        confirmationPromptSentAt: v.optional(v.union(v.number(), v.null())),
        confirmationResolvedAt: v.optional(v.union(v.number(), v.null())),
        createdAt: v.number(),
        apprenticeNotifiedAt: v.union(v.number(), v.null()),
        masterNotifiedAt: v.union(v.number(), v.null()),
    })
        .index("by_matchRequestId", ["matchRequestId"])
        .index("by_apprenticeId", ["apprenticeId"])
        .index("by_masterId", ["masterId"])
        .index("by_status", ["status"])
        .index("by_status_and_confirmationState", ["status", "confirmationState"])
        .index("by_apprenticePhone_and_confirmationState", ["apprenticePhone", "confirmationState"]),

    interactionSessions: defineTable({
        sessionId: v.string(),
        phoneNumber: v.string(),
        channel: smsChannel,
        state: v.union(v.literal("awaiting_location"), v.literal("awaiting_craft"), v.literal("completed")),
        locationText: v.union(v.string(), v.null()),
        locationKey: v.union(v.string(), v.null()),
        craftText: v.union(v.string(), v.null()),
        craftKey: v.union(v.string(), v.null()),
        createdAt: v.number(),
        updatedAt: v.number(),
        expiresAt: v.number(),
    })
        .index("by_sessionId", ["sessionId"])
        .index("by_phoneNumber_and_channel", ["phoneNumber", "channel"]),

    // Idempotency guard: dedupes provider webhook retries (Twilio/AT resend on timeout).
    processedWebhooks: defineTable({
        key: v.string(),
        channel: v.union(v.literal("sms"), v.literal("ussd"), v.literal("voice"), v.literal("agentmail")),
        reply: v.string(),
        createdAt: v.number(),
    }).index("by_key", ["key"]),

    inboundMessages: defineTable({
        fromPhone: v.string(),
        body: v.string(),
        channel: smsChannel,
        provider: telephonyProvider,
        rawPayload: v.string(),
        createdAt: v.number(),
    })
        .index("by_fromPhone", ["fromPhone"])
        .index("by_channel", ["channel"]),

    outboundMessages: defineTable({
        recipientPhone: v.string(),
        body: v.string(),
        channel: v.literal("sms"),
        provider: telephonyProvider,
        providerStatus: v.union(
            v.literal("queued"),
            v.literal("sent"),
            v.literal("failed"),
            v.literal("dead_letter")
        ),
        messageType: v.optional(outboundMessageType),
        providerMessageId: v.union(v.string(), v.null()),
        // Retry/backoff bookkeeping for the outbox worker.
        failedAttempts: v.optional(v.number()),
        nextAttemptAt: v.optional(v.number()),
        relatedMasterId: v.union(v.id("masters"), v.null()),
        relatedApprenticeId: v.union(v.id("apprentices"), v.null()),
        relatedMatchRequestId: v.union(v.id("matchRequests"), v.null()),
        relatedMatchId: v.optional(v.union(v.id("matches"), v.null())),
        createdAt: v.number(),
        sentAt: v.union(v.number(), v.null()),
        lastError: v.union(v.string(), v.null()),
    })
        .index("by_recipientPhone", ["recipientPhone"])
        .index("by_providerStatus", ["providerStatus"])
        .index("by_relatedMasterId", ["relatedMasterId"])
        .index("by_relatedApprenticeId", ["relatedApprenticeId"])
        .index("by_relatedMatchRequestId", ["relatedMatchRequestId"]),

    // --- Invest in Public ---

    ventures: defineTable({
        name: v.string(),
        craftText: v.string(),
        craftKey: v.string(),
        locationText: v.string(),
        locationKey: v.string(),
        summary: v.string(),
        kpiLabel: v.string(),
        kpiUnit,
        kpiTarget: v.number(),
        peerMedian: v.optional(v.number()),
        agentEmail: v.optional(v.string()),
        publicSlug: v.string(),
        masterId: v.optional(v.union(v.id("masters"), v.null())),
        apprenticeId: v.optional(v.union(v.id("apprentices"), v.null())),
        status: v.union(v.literal("active"), v.literal("paused"), v.literal("graduated")),
        createdAt: v.number(),
        updatedAt: v.number(),
    })
        .index("by_publicSlug", ["publicSlug"])
        .index("by_status", ["status"])
        .index("by_craftKey", ["craftKey"])
        .index("by_agentEmail", ["agentEmail"]),

    investors: defineTable({
        displayName: v.string(),
        email: v.optional(v.union(v.string(), v.null())),
        phone: v.optional(v.union(v.string(), v.null())),
        userId: v.optional(v.union(v.id("users"), v.null())),
        isDefaultDemo: v.optional(v.boolean()),
        createdAt: v.number(),
    })
        .index("by_email", ["email"])
        .index("by_userId", ["userId"])
        .index("by_isDefaultDemo", ["isDefaultDemo"]),

    /** Auth-user orientation prefs (replaces browser flags when signed in). */
    userPrefs: defineTable({
        userId: v.id("users"),
        onboarded: v.boolean(),
        coachDismissed: v.boolean(),
        lastOrientedAt: v.optional(v.number()),
        updatedAt: v.number(),
    }).index("by_userId", ["userId"]),

    /**
     * Demo/soft magic-link inbox when Resend is not configured.
     * Disable peek in live (SOFT_AUTH_INBOX unset) once AUTH_RESEND_KEY is live.
     */
    softAuthLinks: defineTable({
        email: v.string(),
        url: v.string(),
        createdAt: v.number(),
    }).index("by_email", ["email"]),

    /** Singleton-ish AgentMail wiring (key = "default"). */
    agentMailConfig: defineTable({
        key: v.string(),
        inboxId: v.string(),
        inboxEmail: v.string(),
        webhookId: v.optional(v.string()),
        updatedAt: v.number(),
    }).index("by_key", ["key"]),

    /** Server-only secrets (webhook signing). Never expose via public queries. */
    agentMailSecrets: defineTable({
        key: v.string(),
        value: v.string(),
        updatedAt: v.number(),
    }).index("by_key", ["key"]),

    commitments: defineTable({
        investorId: v.id("investors"),
        ventureId: v.id("ventures"),
        amountKes: v.number(),
        shareBps: v.number(),
        capMultiple: v.number(),
        status: commitmentStatus,
        thesis: v.string(),
        nextDigestAt: v.optional(v.number()),
        digestCadence: v.optional(v.string()),
        createdAt: v.number(),
        updatedAt: v.number(),
    })
        .index("by_investorId", ["investorId"])
        .index("by_ventureId", ["ventureId"])
        .index("by_status", ["status"]),

    kpiCheckIns: defineTable({
        ventureId: v.id("ventures"),
        commitmentId: v.optional(v.union(v.id("commitments"), v.null())),
        periodLabel: v.string(),
        metric: v.string(),
        value: v.number(),
        note: v.string(),
        source: kpiSource,
        createdAt: v.number(),
    })
        .index("by_ventureId", ["ventureId"])
        .index("by_commitmentId", ["commitmentId"])
        .index("by_createdAt", ["createdAt"]),

    agentDigests: defineTable({
        commitmentId: v.id("commitments"),
        ventureId: v.id("ventures"),
        summary: v.string(),
        insights: v.string(),
        /** What the investor should do next (digest artifact card). */
        nextAction: v.optional(v.union(v.string(), v.null())),
        /** Evidence source tags, e.g. ["email", "agent"]. */
        evidence: v.optional(v.array(v.string())),
        createdAt: v.number(),
    })
        .index("by_commitmentId", ["commitmentId"])
        .index("by_ventureId", ["ventureId"])
        .index("by_createdAt", ["createdAt"]),

    /**
     * Durable agent runs (approve & run). Each step commits separately so the
     * UI can stream truthful progress; inbound AgentMail writes completed runs.
     * `proposed` runs are proactive: Jua suggests work and waits for approval.
     */
    agentRuns: defineTable({
        commitmentId: v.id("commitments"),
        ventureId: v.id("ventures"),
        investorId: v.id("investors"),
        status: v.union(
            v.literal("proposed"),
            v.literal("running"),
            v.literal("completed"),
            v.literal("failed"),
            v.literal("dismissed")
        ),
        trigger: v.union(
            v.literal("approved_note"),
            v.literal("inbound_email"),
            v.literal("proactive")
        ),
        noteBody: v.string(),
        subject: v.string(),
        metricOverride: v.optional(v.union(v.string(), v.null())),
        valueOverride: v.optional(v.union(v.number(), v.null())),
        fromAddress: v.string(),
        toAddress: v.string(),
        source: kpiSource,
        steps: v.array(
            v.object({
                tool: v.string(),
                label: v.string(),
                status: v.union(
                    v.literal("pending"),
                    v.literal("running"),
                    v.literal("done"),
                    v.literal("failed")
                ),
                detail: v.union(v.string(), v.null()),
            })
        ),
        result: v.optional(
            v.union(
                v.object({
                    checkInId: v.id("kpiCheckIns"),
                    digestId: v.id("agentDigests"),
                    replyId: v.id("agentEmails"),
                    message: v.string(),
                    kpiMetric: v.string(),
                    kpiValue: v.number(),
                    kpiBefore: v.number(),
                    kpiAfter: v.number(),
                    replyTo: v.string(),
                }),
                v.null()
            )
        ),
        error: v.optional(v.union(v.string(), v.null())),
        createdAt: v.number(),
        updatedAt: v.number(),
    })
        .index("by_commitmentId", ["commitmentId"])
        .index("by_ventureId", ["ventureId"])
        .index("by_status", ["status"]),

    agentEmails: defineTable({
        commitmentId: v.id("commitments"),
        ventureId: v.id("ventures"),
        investorId: v.id("investors"),
        direction: v.union(v.literal("inbound"), v.literal("outbound")),
        fromAddress: v.string(),
        toAddress: v.string(),
        subject: v.string(),
        body: v.string(),
        createdAt: v.number(),
    })
        .index("by_commitmentId", ["commitmentId"])
        .index("by_ventureId", ["ventureId"])
        .index("by_investorId", ["investorId"])
        .index("by_createdAt", ["createdAt"]),

    ledgerEvents: defineTable({
        type: ledgerEventType,
        ventureId: v.optional(v.union(v.id("ventures"), v.null())),
        commitmentId: v.optional(v.union(v.id("commitments"), v.null())),
        summary: v.string(),
        amountKes: v.optional(v.union(v.number(), v.null())),
        metric: v.optional(v.union(v.string(), v.null())),
        value: v.optional(v.union(v.number(), v.null())),
        /** Evidence source tags, e.g. ["email", "agent", "photo"]. */
        evidence: v.optional(v.array(v.string())),
        createdAt: v.number(),
        publicVisible: v.boolean(),
    })
        .index("by_publicVisible_and_createdAt", ["publicVisible", "createdAt"])
        .index("by_ventureId", ["ventureId"])
        .index("by_createdAt", ["createdAt"]),

    /** RevenueCat entitlements per investor (Shipaton 2026 monetization). */
    subscriptions: defineTable({
        investorId: v.id("investors"),
        revenueCatAppUserId: v.string(),
        entitlements: v.array(v.string()),
        productId: v.union(v.string(), v.null()),
        status: v.union(v.literal("active"), v.literal("expired")),
        expiresAt: v.union(v.number(), v.null()),
        updatedAt: v.number(),
    })
        .index("by_investorId", ["investorId"])
        .index("by_revenueCatAppUserId", ["revenueCatAppUserId"]),
});
