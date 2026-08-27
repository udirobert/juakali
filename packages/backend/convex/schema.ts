import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";
import { actionPlanValidator, autonomyLevelValidator } from "./actionPlan";
import { ventureSummaryValidator } from "./investorBriefing";

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
    v.literal("email_paste"),
    v.literal("self")
);
const ledgerEventType = v.union(
    v.literal("pledge"),
    v.literal("checkin"),
    v.literal("digest"),
    v.literal("action"),
    v.literal("wisdom")
);
const sharedKind = v.union(
    v.literal("article"),
    v.literal("podcast"),
    v.literal("note"),
    v.literal("voice")
);

const briefingActivityStatus = v.union(
    v.literal("proposed"),
    v.literal("running"),
    v.literal("waiting_for_response"),
    v.literal("awaiting_publication"),
    v.literal("completed"),
    v.literal("failed"),
    v.literal("dismissed")
);
const briefingActivityTrigger = v.union(
    v.literal("approved_note"),
    v.literal("inbound_email"),
    v.literal("proactive"),
    v.literal("entrepreneur_note")
);
/** One denormalized activity row inside an investor's briefing index. */
const briefingActivityItem = v.object({
    id: v.id("agentRuns"),
    commitmentId: v.id("commitments"),
    ventureName: v.string(),
    status: briefingActivityStatus,
    trigger: briefingActivityTrigger,
    subject: v.string(),
    error: v.union(v.string(), v.null()),
    updatedAt: v.number(),
    /** Decisions only: when the run was created (oldest decision surfaces first). */
    createdAt: v.optional(v.number()),
    /** Completed runs only: the human-facing result line. */
    title: v.optional(v.string()),
    /** Completed runs only: the public proof ledger event for this run. */
    proofEventId: v.optional(v.union(v.id("ledgerEvents"), v.null())),
});

/** One commitment's cockpit projection inside the investor briefing index. */
const cockpitCommitmentValidator = v.object({
    commitmentId: v.id("commitments"),
    venture: ventureSummaryValidator,
    latestDigest: v.union(
        v.object({
            id: v.id("agentDigests"),
            summary: v.string(),
            insights: v.string(),
            nextAction: v.union(v.string(), v.null()),
            evidence: v.array(v.string()),
            createdAt: v.number(),
        }),
        v.null()
    ),
    recentCheckIns: v.array(
        v.object({
            id: v.id("kpiCheckIns"),
            periodLabel: v.string(),
            metric: v.string(),
            value: v.number(),
            note: v.string(),
            source: kpiSource,
            createdAt: v.number(),
        })
    ),
    recentEmails: v.array(
        v.object({
            id: v.id("agentEmails"),
            direction: v.union(v.literal("inbound"), v.literal("outbound")),
            fromAddress: v.string(),
            toAddress: v.string(),
            subject: v.string(),
            body: v.string(),
            createdAt: v.number(),
        })
    ),
    openProposal: v.union(
        v.object({
            id: v.id("agentRuns"),
            noteBody: v.string(),
            subject: v.string(),
            createdAt: v.number(),
        }),
        v.null()
    ),
});

const briefingPresenceValidator = v.object({
    lastWorkedAt: v.union(v.number(), v.null()),
    runsThisWeek: v.number(),
    openProposals: v.number(),
});

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
        /** How much Jua may auto-start. Default ask_every_time. */
        autonomyLevel: v.optional(autonomyLevelValidator),
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
        autonomyLevel: v.optional(autonomyLevelValidator),
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

    /** Immutable evidence submitted by a venture owner or recorded by an investor. */
    founderEvidence: defineTable({
        runId: v.id("agentRuns"),
        ventureId: v.id("ventures"),
        commitmentId: v.id("commitments"),
        metric: v.string(),
        value: v.number(),
        note: v.string(),
        source: v.union(v.literal("founder_update"), v.literal("investor_entered")),
        submittedByUserId: v.optional(v.union(v.id("users"), v.null())),
        createdAt: v.number(),
    })
        .index("by_runId", ["runId"])
        .index("by_ventureId", ["ventureId"]),

    kpiCheckIns: defineTable({
        ventureId: v.id("ventures"),
        commitmentId: v.optional(v.union(v.id("commitments"), v.null())),
        periodLabel: v.string(),
        metric: v.string(),
        value: v.number(),
        note: v.string(),
        source: kpiSource,
        /** Evidence provenance is distinct from the pipeline transport source. */
        evidenceSource: v.optional(
            v.union(v.literal("founder_update"), v.literal("investor_entered"), v.null())
        ),
        /** Immutable founder/investor evidence that supports this check-in. */
        evidenceId: v.optional(v.union(v.id("founderEvidence"), v.null())),
        /** Set when this check-in measures a piece of applied mentor wisdom. */
        appliedItemId: v.optional(v.union(v.id("sharedItems"), v.null())),
        createdAt: v.number(),
    })
        .index("by_ventureId", ["ventureId"])
        .index("by_commitmentId", ["commitmentId"])
        .index("by_createdAt", ["createdAt"]),

    /**
     * Entrepreneurs — venture owners. The second side of the loop: links an
     * auth user to a venture the same way `investors` links users to capital.
     */
    ventureOwners: defineTable({
        userId: v.id("users"),
        ventureId: v.id("ventures"),
        role: v.literal("owner"),
        createdAt: v.number(),
    })
        .index("by_userId", ["userId"])
        .index("by_ventureId", ["ventureId"]),

    /**
     * Denormalized per-investor activity/briefing index. Maintained by
     * syncInvestorBriefing on every run lifecycle transition (and commitment
     * change), so the Today briefing and activity feed read this single doc
     * instead of re-scanning every commitment's runs and per-run ledger events
     * on each query evaluation.
     */
    investorBriefings: defineTable({
        investorId: v.id("investors"),
        /** Runs awaiting a decision (proposed + awaiting_publication), oldest first. */
        decisions: v.array(briefingActivityItem),
        /** Currently executing runs. */
        active: v.array(briefingActivityItem),
        /** Runs parked waiting for founder evidence. */
        waiting: v.array(briefingActivityItem),
        /** Failed runs needing recovery. */
        failed: v.array(briefingActivityItem),
        /** Recently completed runs (last 7 days), newest first. */
        completed: v.array(briefingActivityItem),
        /** Venture ids with a completed run in the last 7 days. */
        movedVentureIds: v.array(v.id("ventures")),
        /** Count of failed runs (the "blocked" stat). */
        blockedCount: v.number(),
        nextScheduled: v.union(v.object({ label: v.string(), at: v.number() }), v.null()),
        /**
         * Per-commitment cockpit projection so investorCockpit reads one doc.
         * OPTIONAL ONLY DURING THE MIGRATION WINDOW: docs written before the
         * cockpit projection landed (pre-8516382) lack cockpit/presence, and a
         * required field made every read of those docs throw a schema
         * validation error. syncInvestorBriefing always writes both fields, and
         * migrations:backfillInvestorBriefings repairs existing docs — once it
         * completes for every investor, narrow these back to required and drop
         * the scan fallback in investorCockpit.
         */
        cockpit: v.optional(v.array(cockpitCommitmentValidator)),
        /** Presence stats for the cockpit's agent-presence block. See cockpit. */
        presence: v.optional(briefingPresenceValidator),
        updatedAt: v.number(),
    }).index("by_investorId", ["investorId"]),

    /**
     * Global denormalized venture browse index (one doc). Maintained by
     * syncVentureBrowse on venture creation, KPI record, and pledge writes,
     * so the cockpit's availableVentures browse list and the landing browse
     * read one doc instead of re-scanning every venture + KPI + pledge on
     * each query evaluation. The list is identical for every investor, so a
     * singleton (not per-investor rows) is the right shape.
     */
    ventureBrowse: defineTable({
        ventures: v.array(ventureSummaryValidator),
        updatedAt: v.number(),
    }),

    /**
     * Shared wisdom — a mentor's podcast, article, note, or dictated voice,
     * parsed by Jua into an applicable recommendation for one venture.
     * `applied` items carry measurable outcomes via kpiCheckIns.appliedItemId.
     */
    sharedItems: defineTable({
        ventureId: v.id("ventures"),
        investorId: v.optional(v.union(v.id("investors"), v.null())),
        kind: sharedKind,
        sourceUrl: v.optional(v.union(v.string(), v.null())),
        title: v.optional(v.union(v.string(), v.null())),
        body: v.string(),
        charCount: v.number(),
        status: v.union(
            v.literal("pending"),
            v.literal("parsed"),
            v.literal("applied"),
            v.literal("archived")
        ),
        /** Jua's parse — absent while pending, present once parsed. */
        parse: v.optional(
            v.object({
                summary: v.string(),
                principles: v.array(v.string()),
                application: v.object({ title: v.string(), body: v.string() }),
                confidence: v.number(),
                engine: v.union(v.literal("gemini"), v.literal("fallback")),
            })
        ),
        appliedAt: v.optional(v.union(v.number(), v.null())),
        createdAt: v.number(),
    })
        .index("by_ventureId", ["ventureId"])
        .index("by_status", ["status"])
        .index("by_ventureId_and_status", ["ventureId", "status"]),

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
            v.literal("waiting_for_response"),
            v.literal("awaiting_publication"),
            v.literal("completed"),
            v.literal("failed"),
            v.literal("dismissed")
        ),
        trigger: v.union(
            v.literal("approved_note"),
            v.literal("inbound_email"),
            v.literal("proactive"),
            v.literal("entrepreneur_note")
        ),
        noteBody: v.string(),
        subject: v.string(),
        metricOverride: v.optional(v.union(v.string(), v.null())),
        valueOverride: v.optional(v.union(v.number(), v.null())),
        fromAddress: v.string(),
        toAddress: v.string(),
        source: kpiSource,
        /** Provenance of the evidence consumed by this run, if any. */
        evidenceSource: v.optional(
            v.union(v.literal("founder_update"), v.literal("investor_entered"), v.null())
        ),
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
        /** Structured trust contract (reason, effects, visibility, recovery). */
        actionPlan: v.optional(actionPlanValidator),
        /** Correlates ledger events written by this run. */
        correlationId: v.optional(v.string()),
        /** The verbatim approved public summary (set by approveProposal). */
        approvedSummary: v.optional(v.string()),
        /** True when the run was auto-started under auto_low_risk autonomy. */
        autoStarted: v.optional(v.boolean()),
        /**
         * Intermediate pipeline outputs, persisted as each step commits so a
         * failed run can resume idempotently without re-running committed
         * effects (no duplicate KPI / digest / ledger / reply).
         */
        pipeline: v.optional(
            v.object({
                checkInId: v.optional(v.id("kpiCheckIns")),
                digestId: v.optional(v.id("agentDigests")),
                replyId: v.optional(v.id("agentEmails")),
                requestEmailId: v.optional(v.id("agentEmails")),
                /** Immutable evidence record that unlocked the KPI step. */
                evidenceId: v.optional(v.id("founderEvidence")),
                /** Ledger event ids — explicit causal edges (parentEventId). */
                requestEventId: v.optional(v.id("ledgerEvents")),
                checkinEventId: v.optional(v.id("ledgerEvents")),
                digestEventId: v.optional(v.id("ledgerEvents")),
                ledgerEventId: v.optional(v.id("ledgerEvents")),
                kpiMetric: v.optional(v.string()),
                kpiValue: v.optional(v.number()),
                kpiBefore: v.optional(v.number()),
                kpiAfter: v.optional(v.number()),
                /** True once a KPI was recorded (or deliberately skipped). */
                kpiResolved: v.optional(v.boolean()),
            })
        ),
        result: v.optional(
            v.union(
                v.object({
                    checkInId: v.union(v.id("kpiCheckIns"), v.null()),
                    digestId: v.union(v.id("agentDigests"), v.null()),
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
        .index("by_status", ["status"])
        .index("by_investorId", ["investorId"]),

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
        /** Denormalized at write time so the public feed needs zero venture
         *  lookups. Ventures have no rename path, so these never go stale. */
        ventureName: v.optional(v.union(v.string(), v.null())),
        ventureSlug: v.optional(v.union(v.string(), v.null())),
        summary: v.string(),
        amountKes: v.optional(v.union(v.number(), v.null())),
        metric: v.optional(v.union(v.string(), v.null())),
        value: v.optional(v.union(v.number(), v.null())),
        /** Evidence source tags, e.g. ["email", "agent", "photo"]. */
        evidence: v.optional(v.array(v.string())),
        createdAt: v.number(),
        publicVisible: v.boolean(),
        /** Causal proof chain fields (optional for legacy rows). */
        runId: v.optional(v.union(v.id("agentRuns"), v.null())),
        correlationId: v.optional(v.union(v.string(), v.null())),
        parentEventId: v.optional(v.union(v.id("ledgerEvents"), v.null())),
        initiator: v.optional(
            v.union(
                v.literal("investor"),
                v.literal("founder"),
                v.literal("jua"),
                v.literal("system")
            )
        ),
        approvalRunId: v.optional(v.union(v.id("agentRuns"), v.null())),
        correctionOf: v.optional(v.union(v.id("ledgerEvents"), v.null())),
        disputeState: v.optional(
            v.union(v.literal("none"), v.literal("corrected"), v.literal("disputed"))
        ),
    })
        .index("by_publicVisible_and_createdAt", ["publicVisible", "createdAt"])
        .index("by_ventureId", ["ventureId"])
        .index("by_createdAt", ["createdAt"])
        .index("by_correlationId", ["correlationId"])
        .index("by_runId", ["runId"]),

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
