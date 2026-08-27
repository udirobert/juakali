import { GoogleGenerativeAI, type FunctionDeclaration, SchemaType } from "@google/generative-ai";
import { convexQuery, convexMutation } from "./convex-client.js";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY ?? "");

const toolDeclarations: FunctionDeclaration[] = [
    {
        name: "list_ventures",
        description: "List investable apprentice ventures with KPI targets, totals, and pledged capital.",
        parameters: { type: SchemaType.OBJECT, properties: {} },
    },
    {
        name: "pledge_commitment",
        description:
            "Create a soft revenue-share microcommitment from the default demo investor into a venture. Demo only — not a live payment.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                ventureName: { type: SchemaType.STRING, description: "Venture name or partial match (e.g. Amina)" },
                ventureSlug: { type: SchemaType.STRING, description: "Public slug if known" },
                amountKes: { type: SchemaType.NUMBER, description: "Soft pledge amount in Kenyan Shillings" },
                shareBps: { type: SchemaType.NUMBER, description: "Revenue share in basis points (1000 = 10%)" },
                capMultiple: { type: SchemaType.NUMBER, description: "Cap multiple (e.g. 2)" },
                thesis: { type: SchemaType.STRING, description: "Short investment thesis" },
            },
            required: ["amountKes"],
        },
    },
    {
        name: "log_kpi_checkin",
        description:
            "Log a hard KPI result for a venture (meetings booked, revenue_kes, jobs_completed, etc.) and publish it to the public ledger.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                ventureName: { type: SchemaType.STRING, description: "Venture name or partial match" },
                ventureSlug: { type: SchemaType.STRING, description: "Public slug if known" },
                metric: { type: SchemaType.STRING, description: "Metric key e.g. meetings_booked, revenue_kes, jobs_completed" },
                value: { type: SchemaType.NUMBER, description: "Numeric result" },
                periodLabel: { type: SchemaType.STRING, description: "Period label e.g. Week 3" },
                note: { type: SchemaType.STRING, description: "Evidence note" },
                source: {
                    type: SchemaType.STRING,
                    format: "enum",
                    enum: ["agent", "sms", "manual", "email_paste"],
                    description: "How the evidence arrived",
                },
            },
            required: ["metric", "value"],
        },
    },
    {
        name: "create_investor_digest",
        description: "Draft an investor digest summarizing progress and recommended next actions for a funded venture.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                ventureName: { type: SchemaType.STRING, description: "Venture name or partial match" },
                summary: { type: SchemaType.STRING, description: "Short headline summary of results" },
                insights: { type: SchemaType.STRING, description: "Recommendations / insights for the investor" },
            },
            required: ["summary", "insights"],
        },
    },
    {
        name: "get_public_ledger",
        description: "Read the public invest-in-public ledger: pledges, check-ins, digests, and totals.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                limit: { type: SchemaType.NUMBER, description: "Max events to return" },
            },
        },
    },
    {
        name: "seed_invest_demo",
        description: "Seed demo investors, ventures, pledges, KPI check-ins, digests, and ledger events.",
        parameters: { type: SchemaType.OBJECT, properties: {} },
    },
    {
        name: "register_master",
        description: "Funnel tool: register a master artisan profile.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                name: { type: SchemaType.STRING, description: "Full name" },
                phoneNumber: { type: SchemaType.STRING, description: "E.164 phone or empty" },
                locationText: { type: SchemaType.STRING, description: "Town or area" },
                craftText: { type: SchemaType.STRING, description: "Primary craft" },
                keySkills: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: "Skills taught (max 6)" },
                profileSummary: { type: SchemaType.STRING, description: "Short bio" },
                language: {
                    type: SchemaType.STRING,
                    format: "enum",
                    enum: ["sw", "en", "mixed", "unknown"],
                    description: "Language",
                },
            },
            required: ["name", "locationText", "craftText", "keySkills", "profileSummary", "language"],
        },
    },
    {
        name: "match_apprentice",
        description: "Funnel tool: match an apprentice to masters by craft and location.",
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
        description: "Funnel ops: masters/apprentices/match analytics.",
        parameters: { type: SchemaType.OBJECT, properties: {} },
    },
    {
        name: "list_masters",
        description: "Funnel ops: list registered master artisans.",
        parameters: { type: SchemaType.OBJECT, properties: {} },
    },
    {
        name: "queue_sms",
        description: "Queue an SMS for delivery.",
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
        description: "Seed telephony funnel demo masters/matches.",
        parameters: { type: SchemaType.OBJECT, properties: {} },
    },
];

const SYSTEM_PROMPT = `You are Jua — the JuaKali agent, a mentor and monitor for "invest in public" microinvestments in Kenya's informal sector ("Jua Kali"). You track each venture's KPIs, write investor digests, and post every step to the public ledger — the founder runs the venture, you make it visible. Your name is Jua (Swahili for sun); you sign your work "— Jua · JuaKali agent".

Primary job (investor is the client):
- Help busy investors make soft revenue-share microcommitments into apprentice ventures (demo pledges, not live payments or securities).
- Mentor ventures: turn investor emails/notes pasted into chat into structured actions and KPI check-ins.
- Log hard results (meetings booked, revenue_kes, jobs completed) onto the public ledger.
- Draft investor digests summarizing evidence and recommending next actions.
- Keep the public ledger accurate: capital → actions → results.

Secondary job (matching funnel):
- Register masters from voice transcripts, match apprentices by craft/location, queue SMS, track connection confirmations.

Instrument language:
- Soft pledge + revenue share (basis points, cap multiple). Never claim regulated equity or live escrow.
- Be transparent about demo mode when relevant.

Common crafts: carpentry, welding, tailoring, mechanics, sales, masonry, plumbing, electrical, hairdressing.
Common locations: Kariobangi, Kisumu, Mombasa, Thika, Eldoret, Nakuru, Kibera, Nairobi.

Languages: Swahili and English. Reply in the user's language. Warm, direct, fiduciary tone toward the investor.
Always use your tools to take action — don't just describe what should happen.`;

interface ToolCallResult {
    name: string;
    response: Record<string, unknown>;
}

async function executeToolCall(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    switch (name) {
        case "list_ventures":
            return await convexQuery("invest:listVenturesViaMcp", {});

        case "pledge_commitment":
            return await convexMutation("invest:pledgeViaMcp", {
                ventureName: (args.ventureName as string) || undefined,
                ventureSlug: (args.ventureSlug as string) || undefined,
                amountKes: args.amountKes as number,
                shareBps: (args.shareBps as number) || undefined,
                capMultiple: (args.capMultiple as number) || undefined,
                thesis: (args.thesis as string) || undefined,
            });

        case "log_kpi_checkin":
            return await convexMutation("invest:logKpiViaMcp", {
                ventureName: (args.ventureName as string) || undefined,
                ventureSlug: (args.ventureSlug as string) || undefined,
                metric: args.metric as string,
                value: args.value as number,
                periodLabel: (args.periodLabel as string) || undefined,
                note: (args.note as string) || undefined,
                source: (args.source as string) || "agent",
            });

        case "create_investor_digest":
            return await convexMutation("invest:createDigestViaMcp", {
                ventureName: (args.ventureName as string) || undefined,
                summary: args.summary as string,
                insights: args.insights as string,
            });

        case "get_public_ledger":
            return await convexQuery("invest:getPublicLedgerViaMcp", {
                limit: (args.limit as number) || 20,
            });

        case "seed_invest_demo":
            return await convexMutation("invest:seedInvestDemo", {});

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
            // *ViaMcp variants: public HTTP endpoints (rate-limited), unlike the
            // session-guarded dashboardData/seedDemoData used by the app UI.
            const data = await convexQuery<{ analytics: Record<string, unknown> }>(
                "telephony:dashboardDataViaMcp",
                {}
            );
            return data.analytics;
        }

        case "list_masters": {
            const data = await convexQuery<{ masters: Array<Record<string, unknown>> }>(
                "telephony:dashboardDataViaMcp",
                {}
            );
            return { masters: data.masters };
        }

        case "queue_sms":
            return await convexMutation("telephony:queueSmsViaMcp", {
                recipientPhone: args.recipientPhone as string,
                body: args.body as string,
            });

        case "seed_demo":
            return await convexMutation("telephony:seedDemoDataViaMcp", {});

        default:
            return { error: `Unknown tool: ${name}` };
    }
}

export async function runAgent(userMessage: string): Promise<string> {
    const model = genAI.getGenerativeModel({
        model: "gemini-3.6-flash",
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
                    role: "user",
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
