import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callBackend } from "./backend-client.js";

export function registerTools(server: McpServer): void {
    server.tool(
        "register_master",
        "Register a new master artisan profile from extracted voice/text data. Masters are skilled craftspeople (carpenters, welders, tailors, etc.) who teach apprentices.",
        {
            name: z.string().describe("Master artisan's full name"),
            phoneNumber: z.string().nullable().describe("Phone number in E.164 format (e.g. +254711000000) or null if unknown"),
            locationText: z.string().describe("Town or area name (e.g. Kariobangi, Kisumu, Mombasa)"),
            craftText: z.string().describe("Primary craft (e.g. welding, carpentry, tailoring, mechanics)"),
            keySkills: z.array(z.string()).max(6).describe("List of specific skills they teach (max 6)"),
            profileSummary: z.string().describe("Short bio summarizing their experience and what they teach"),
            language: z.enum(["sw", "en", "mixed", "unknown"]).describe("Primary language spoken"),
            transcript: z.string().nullable().optional().describe("Original transcript text if available"),
        },
        async (input) => {
            const result = await callBackend<{ masterId: string; message: string }>(
                "telephony:registerMasterViaMcp",
                {
                    name: input.name,
                    phoneNumber: input.phoneNumber,
                    locationText: input.locationText,
                    craftText: input.craftText,
                    keySkills: input.keySkills,
                    profileSummary: input.profileSummary,
                    language: input.language,
                    transcript: input.transcript ?? null,
                },
                "mutation"
            );
            return {
                content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
            };
        }
    );

    server.tool(
        "match_apprentice",
        "Find and match an apprentice with the best available master artisans based on craft and location. Returns ranked matches with scores.",
        {
            phoneNumber: z.string().describe("Apprentice's phone number in E.164 format"),
            locationText: z.string().describe("Town or area where the apprentice is located"),
            craftText: z.string().describe("Craft the apprentice wants to learn"),
        },
        async (input) => {
            const result = await callBackend<{
                requestId: string;
                reply: string;
                matches: Array<{
                    id: string;
                    name: string;
                    locationText: string;
                    craftText: string;
                    keySkills: string[];
                    profileSummary: string;
                    phoneNumber: string | null;
                    score: number;
                }>;
            }>(
                "telephony:runApprenticeInterview",
                {
                    phoneNumber: input.phoneNumber,
                    locationText: input.locationText,
                    craftText: input.craftText,
                },
                "mutation"
            );
            return {
                content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
            };
        }
    );

    server.tool(
        "get_dashboard",
        "Get the current system status including counts of masters, apprentices, matches, queued messages, and analytics breakdowns by craft and location.",
        {},
        async () => {
            const result = await callBackend<{
                analytics: {
                    totalMasters: number;
                    totalApprentices: number;
                    totalMatches: number;
                    queuedSms: number;
                    verifiedMasters: number;
                    confirmedConnections: number;
                    awaitingConfirmation: number;
                    mastersByCraft: Array<{ label: string; count: number }>;
                    apprenticesByCraft: Array<{ label: string; count: number }>;
                    signupsByLocation: Array<{ label: string; count: number }>;
                };
            }>("telephony:dashboardData", {}, "query");

            return {
                content: [{ type: "text" as const, text: JSON.stringify(result.analytics, null, 2) }],
            };
        }
    );

    server.tool(
        "list_masters",
        "List registered master artisans. Returns recent masters with their craft, location, skills, and verification status.",
        {
            craft: z.string().optional().describe("Filter by craft name (e.g. welding, carpentry)"),
            location: z.string().optional().describe("Filter by location name"),
        },
        async (input) => {
            const result = await callBackend<{
                masters: Array<{
                    id: string;
                    name: string;
                    phoneNumber: string | null;
                    locationText: string;
                    craftText: string;
                    keySkills: string[];
                    profileSummary: string;
                    status: string;
                    confirmedMatchCount: number;
                    isVerified: boolean;
                }>;
            }>("telephony:dashboardData", {}, "query");

            let masters = result.masters;
            if (input.craft) {
                const craft = input.craft.toLowerCase();
                masters = masters.filter((m) => m.craftText.toLowerCase().includes(craft));
            }
            if (input.location) {
                const location = input.location.toLowerCase();
                masters = masters.filter((m) => m.locationText.toLowerCase().includes(location));
            }

            return {
                content: [{ type: "text" as const, text: JSON.stringify(masters, null, 2) }],
            };
        }
    );

    server.tool(
        "send_sms",
        "Queue an SMS message for delivery to a phone number. Messages are sent via the SMS outbox with retry/backoff.",
        {
            recipientPhone: z.string().describe("Recipient phone number in E.164 format"),
            body: z.string().describe("SMS message text"),
        },
        async (input) => {
            const result = await callBackend<{ messageId: string; status: string }>(
                "telephony:queueSmsViaMcp",
                {
                    recipientPhone: input.recipientPhone,
                    body: input.body,
                },
                "mutation"
            );
            return {
                content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
            };
        }
    );

    server.tool(
        "confirm_match",
        "Record whether a master-apprentice match was successful. This updates the master's reputation score.",
        {
            matchId: z.string().describe("The match ID to confirm or deny"),
            connected: z.boolean().describe("True if they connected successfully, false if not"),
        },
        async (input) => {
            const result = await callBackend<{ message: string }>(
                "telephony:confirmMatchViaMcp",
                {
                    matchId: input.matchId,
                    connected: input.connected,
                },
                "mutation"
            );
            return {
                content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
            };
        }
    );

    server.tool(
        "seed_demo_data",
        "Populate the system with demo master artisans and sample matches for testing and demonstrations.",
        {},
        async () => {
            const result = await callBackend<{
                createdMasters: number;
                createdMatches: number;
                message: string;
            }>("telephony:seedDemoData", {}, "mutation");

            return {
                content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
            };
        }
    );

    server.prompt(
        "intake_interview",
        "Process a voice intake transcript and extract a master artisan profile",
        { transcript: z.string() },
        (args) => ({
            messages: [{
                role: "user" as const,
                content: {
                    type: "text" as const,
                    text: `Process this voice intake transcript and extract a master artisan profile. Use the register_master tool to create the profile.\n\nTranscript: ${args.transcript}`,
                },
            }],
        })
    );

    server.prompt(
        "match_workflow",
        "Guide the apprentice matching workflow",
        { craft: z.string(), location: z.string() },
        (args) => ({
            messages: [{
                role: "user" as const,
                content: {
                    type: "text" as const,
                    text: `Find the best master artisan matches for an apprentice looking to learn ${args.craft} near ${args.location}. Use match_apprentice to find matches, then list_masters to get additional details about the top results.`,
                },
            }],
        })
    );
}
