import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Drain the SMS outbox (respects per-message backoff / dead-letter).
crons.interval("drain sms outbox", { minutes: 1 }, internal.smsDelivery.drainOutbox, {});

// Queue post-match confirmation prompts ("Did you connect? 1=Yes 2=No") for matured matches.
crons.interval("queue confirmation prompts", { hours: 1 }, internal.telephony.queueConfirmationPrompts, {});

// Process all queued voice intakes: transcribe recordings and extract master profiles.
crons.interval("process voice intakes", { minutes: 5 }, internal.voiceProcessing.processQueuedVoiceIntakes, {});

// Recover agent runs stuck "running" (dropped schedule) so the cockpit never hangs.
crons.interval(
    "recover stale agent runs",
    { minutes: 5 },
    internal.agentRuns.recoverStaleRuns,
    { olderThanMs: 90_000 }
);

// Agent initiative: propose a check-in when a venture's KPIs go stale.
// Proposals wait for approval — nothing runs until the investor says yes.
crons.interval("propose proactive check-ins", { hours: 1 }, internal.agentRuns.proposeProactiveCheckIns, {});

export default crons;
