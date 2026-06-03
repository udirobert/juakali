import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Drain the SMS outbox (respects per-message backoff / dead-letter).
crons.interval("drain sms outbox", { minutes: 1 }, internal.smsDelivery.drainOutbox, {});

// Queue post-match confirmation prompts ("Did you connect? 1=Yes 2=No") for matured matches.
crons.interval("queue confirmation prompts", { hours: 1 }, internal.telephony.queueConfirmationPrompts, {});

// Process all queued voice intakes: transcribe recordings and extract master profiles.
crons.interval("process voice intakes", { minutes: 5 }, internal.voiceProcessing.processQueuedVoiceIntakes, {});

export default crons;
