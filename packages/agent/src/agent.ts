import { GoogleGenerativeAI, type FunctionDeclaration, SchemaType } from "@google/generative-ai";
import { convexQuery, convexMutation } from "./convex-client.js";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY ?? "");

const toolDeclarations: FunctionDeclaration[] = [
    {
        name: "register_master",
        description: "Register a new master artisan profile. Masters are skilled craftspeople who teach apprentices.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                name: { type: SchemaType.STRING, description: "Full name" },
                phoneNumber: { type: SchemaType.STRING, description: "E.164 phone or empty" },
                locationText: { type: SchemaType.STRING, description: "Town or area" },
                craftText: { type: SchemaType.STRING, description: "Primary craft" },
                keySkills: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: "Skills taught (max 6)" },
                profileSummary: { type: SchemaType.STRING, description: "Short bio" },
                language: { type: SchemaType.STRING, enum: ["sw", "en", "mixed", "unknown"], description: "Language" },
            },
            required: ["name", "locationText", "craftText", "keySkills", "profileSummary", "language"],
        },
    },
    {
        name: "match_apprentice",
        description: "Find and match an apprentice with the best available master artisans by craft and location.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                phoneNumber: { type: SchemaType.STRING, description: "Apprentice phone E.164" },
                locationText: { type: SchemaType.STRING, description: "Apprentice location" },
                craftText: { type: SchemaType.STRING, description: "Craft to learn" },
            },
            required: ["phoneNumber", "locationText", "craftText"],
        },
    },
    {
        name: "get_dashboard",
        description: "Get system status: counts of masters, apprentices, matches, queued SMS, and analytics.",
        parameters: { type: SchemaType.OBJECT, properties: {} },
    },
    {
        name: "list_masters",
        description: "List registered master artisans with their craft, location, skills, and verification status.",
        parameters: { type: SchemaType.OBJECT, properties: {} },
    },
    {
        name: "queue_sms",
        description: "Queue an SMS for delivery to a phone number.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                recipientPhone: { type: SchemaType.STRING, description: "E.164 phone" },
                body: { type: SchemaType.STRING, description: "Message text" },
            },
            required: ["recipientPhone", "body"],
        },
    },
    {
        name: "seed_demo",
        description: "Populate demo master artisans and sample matches for testing.",
        parameters: { type: SchemaType.OBJECT, properties: {} },
    },
];

const SYSTEM_PROMPT = `You are the JuaKali Voice Agent — an autonomous AI that manages an apprenticeship matching platform for Kenya's informal sector ("Jua Kali").

Your job:
- Process voice intakes: artisans call in to register as masters. You extract their profile from transcripts.
- Match apprentices: people text in wanting to learn a craft near their location. You find the best master matches.
- Manage SMS flows: welcome messages, craft/location interviews, match results, confirmation prompts.
- Track reputation: after matches, ask both parties if they connected. Confirmed matches boost the master's reputation.

Common crafts: carpentry, welding, tailoring, mechanics, masonry, plumbing, electrical, hairdressing, painting, metalwork.
Common locations: Kariobangi, Kisumu, Mombasa, Thika, Eldoret, Nakuru, Kibera, Nairobi.

Languages: Swahili and English. Reply in the language the user uses. Use warm, encouraging tone.
Phone format: E.164 (+254...). Kenyan phones starting with 0 become +254.

Always use your tools to take action — don't just describe what should happen, actually do it.`;

interface ToolCallResult {
    name: string;
    response: Record<string, unknown>;
}

async function executeToolCall(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    switch (name) {
        case "register_master":
            return await convexMutation("telephony:registerMasterViaMcp", {
                name: args.name as string,
                phoneNumber: (args.phoneNumber as string) || null,
                locationText: args.locationText as string,
                craftText: args.craftText as string,
                keySkills: (args.keySkills as string[]) ?? [],
                profileSummary: args.profileSummary as string,
                language: args.language as string,
                transcript: null,
            });

        case "match_apprentice":
            return await convexMutation("telephony:runApprenticeInterview", {
                phoneNumber: args.phoneNumber as string,
                locationText: args.locationText as string,
                craftText: args.craftText as string,
            });

        case "get_dashboard": {
            const data = await convexQuery<{ analytics: Record<string, unknown> }>("telephony:dashboardData", {});
            return data.analytics;
        }

        case "list_masters": {
            const data = await convexQuery<{ masters: Array<Record<string, unknown>> }>("telephony:dashboardData", {});
            return { masters: data.masters };
        }

        case "queue_sms":
            return await convexMutation("telephony:queueSmsViaMcp", {
                recipientPhone: args.recipientPhone as string,
                body: args.body as string,
            });

        case "seed_demo":
            return await convexMutation("telephony:seedDemoData", {});

        default:
            return { error: `Unknown tool: ${name}` };
    }
}

export async function runAgent(userMessage: string): Promise<string> {
    const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        systemInstruction: SYSTEM_PROMPT,
        tools: [{ functionDeclarations: toolDeclarations }],
    });

    const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: userMessage }] }],
    });

    const response = result.response;
    const candidate = response.candidates?.[0];
    if (!candidate) return "I couldn't process that request.";

    const toolCalls: ToolCallResult[] = [];
    let finalText = "";

    for (const part of candidate.content?.parts ?? []) {
        if (part.functionCall) {
            const toolResult = await executeToolCall(part.functionCall.name, part.functionCall.args as Record<string, unknown>);
            toolCalls.push({ name: part.functionCall.name, response: toolResult });
        }
        if (part.text) {
            finalText = part.text;
        }
    }

    if (toolCalls.length > 0) {
        const followUp = await model.generateContent({
            contents: [
                { role: "user", parts: [{ text: userMessage }] },
                {
                    role: "model",
                    parts: candidate.content?.parts ?? [],
                },
                {
                    role: "function",
                    parts: toolCalls.map((tc) => ({
                        functionResponse: {
                            name: tc.name,
                            response: tc.response,
                        },
                    })),
                },
            ],
        });

        const followUpText = followUp.response.candidates?.[0]?.content?.parts
            ?.map((p) => p.text ?? "")
            .join("")
            .trim();

        if (followUpText) finalText = followUpText;
    }

    return finalText || "Done. I've processed your request.";
}
