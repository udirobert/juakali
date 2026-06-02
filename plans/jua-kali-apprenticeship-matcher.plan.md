# Jua Kali Apprenticeship Matcher

## Status: completed

## Goal
Build an Expo + Convex prototype that lets Masters register by voice webhook, Apprentices discover Masters by SMS/USSD, and program managers monitor the system from an admin dashboard.

## Steps
- [x] Design Convex database schema for Masters, Apprentices, voice intakes, sessions, matches, and outbound messages.
- [x] Add Convex backend functions for voice intake processing, SMS/USSD flow state, matching, and dashboard data.
- [x] Add HTTP webhook endpoints for inbound voice, recording callbacks, inbound SMS, and USSD sessions.
- [x] Build a responsive Expo admin dashboard with Masters, Apprentices, matches, SMS outbox, and analytics.
- [x] Add demo seeding and queued SMS delivery tooling for prototype testing.
- [x] Redesign dashboard around the organic anti-grid visual direction: sage/terracotta/cream/olive palette, diagonal flow, overlapping blobs, text bleed, and tactile motion.
- [x] Verify Convex deployment and frontend TypeScript/ESLint logs are clean.

## Decisions
- Use Convex tables instead of PostgreSQL/Supabase because this app runs on Bloom's Expo + Convex stack.
- Use Convex HTTP actions instead of Express/FastAPI endpoints.
- Keep telephony provider integration swappable: endpoints accept Twilio-style and Africa's Talking-style payload fields, and outbound SMS is recorded in an outbox table for provider wiring.
- Use OpenAI for voice transcription/profile extraction when a recording URL is provided; if a webhook includes transcript text, the processor can skip ASR.
- Keep decorative organic effects native and lightweight in Expo: gradient meshes, wavy view layers, CSS clip-path on web, and no heavy image assets.

## Notes
- External providers should point to `/webhooks/voice/inbound`, `/webhooks/voice/recording`, `/webhooks/sms/inbound`, and `/webhooks/ussd` on the Convex `.convex.site` deployment URL.
