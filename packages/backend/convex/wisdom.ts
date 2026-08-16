/**
 * Shared wisdom — the mentor side of the loop.
 *
 * A mentor shares a podcast, article, note, or dictated voice note with one
 * venture. Jua parses it (Gemini, same pattern as voice intake profiling)
 * into an applicable recommendation — summary, principles, one concrete
 * application, a confidence — and waits for approval. Applying it posts to
 * the public ledger as a "wisdom" event; subsequent KPI check-ins carry
 * `appliedItemId` so the outcome of the advice is measurable.
 */
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

import { assertCanAct } from "./softAuth";
import { rateLimiter } from "./rateLimit";

const sharedKindValidator = v.union(
    v.literal("article"),
    v.literal("podcast"),
    v.literal("note"),
    v.literal("voice")
);

const parseValidator = v.object({
    summary: v.string(),
    principles: v.array(v.string()),
    application: v.object({ title: v.string(), body: v.string() }),
    confidence: v.number(),
    engine: v.union(v.literal("gemini"), v.literal("fallback")),
});

export const wisdomItemValidator = v.object({
    id: v.id("sharedItems"),
    kind: sharedKindValidator,
    sourceUrl: v.union(v.string(), v.null()),
    title: v.union(v.string(), v.null()),
    body: v.string(),
    charCount: v.number(),
    status: v.union(
        v.literal("pending"),
        v.literal("parsed"),
        v.literal("applied"),
        v.literal("archived")
    ),
    parse: v.optional(parseValidator),
    appliedAt: v.union(v.number(), v.null()),
    /** Measured outcome for applied items: KPI value added since application. */
    outcomeValue: v.union(v.number(), v.null()),
    createdAt: v.number(),
});

/** Resolve the acting investor — linked user, else the demo investor. */
async function resolveInvestorId(ctx: MutationCtx): Promise<Id<"investors"> | null> {
    const userId = await getAuthUserId(ctx);
    if (userId) {
        const byUser = await ctx.db
            .query("investors")
            .withIndex("by_userId", (q) => q.eq("userId", userId))
            .first();
        if (byUser) return byUser._id;
    }
    const demo = await ctx.db
        .query("investors")
        .withIndex("by_isDefaultDemo", (q) => q.eq("isDefaultDemo", true))
        .first();
    return demo?._id ?? null;
}

/** Share a piece of wisdom with a venture — Jua starts reading immediately. */
export const shareWisdom = mutation({
    args: {
        ventureId: v.id("ventures"),
        kind: sharedKindValidator,
        sourceUrl: v.optional(v.string()),
        body: v.optional(v.string()),
    },
    returns: v.object({ itemId: v.id("sharedItems") }),
    handler: async (ctx, args) => {
        await assertCanAct(ctx);
        await rateLimiter.limit(ctx, "investMutate", { key: "wisdom" });

        const body = (args.body ?? "").trim();
        const url = args.sourceUrl?.trim() || null;
        if (!body && !url) throw new Error("Share a link or some text.");

        const investorId = await resolveInvestorId(ctx);
        const now = Date.now();
        const itemId = await ctx.db.insert("sharedItems", {
            ventureId: args.ventureId,
            investorId,
            kind: args.kind,
            sourceUrl: url,
            title: null,
            body,
            charCount: body.length,
            status: "pending",
            appliedAt: null,
            createdAt: now,
        });

        await ctx.scheduler.runAfter(0, internal.wisdom.parseSharedItem, { itemId });
        return { itemId };
    },
});

/** Approve Jua's application — the advice goes to the venture, publicly. */
export const applyWisdom = mutation({
    args: { itemId: v.id("sharedItems") },
    returns: v.object({ ok: v.boolean() }),
    handler: async (ctx, args) => {
        await assertCanAct(ctx);
        const item = await ctx.db.get(args.itemId);
        if (!item) throw new Error("Shared item not found");
        if (item.status !== "parsed" || !item.parse) {
            throw new Error("Jua hasn't finished reading this yet.");
        }

        const now = Date.now();
        await ctx.db.patch(item._id, { status: "applied", appliedAt: now });

        const venture = await ctx.db.get(item.ventureId);
        const mentor = item.investorId ? await ctx.db.get(item.investorId) : null;
        const kindLabel = item.kind === "voice" ? "a voice note" : `a ${item.kind}`;
        await ctx.db.insert("ledgerEvents", {
            type: "wisdom",
            ventureId: item.ventureId,
            commitmentId: null,
            summary: `${mentor?.displayName ?? "A mentor"} shared ${kindLabel}${
                venture ? ` with ${venture.name}` : ""
            } — Jua applied: ${item.parse.application.title}`,
            amountKes: null,
            metric: null,
            value: null,
            evidence: Array.from(new Set(["agent", item.kind])),
            createdAt: now,
            publicVisible: true,
        });
        return { ok: true };
    },
});

/** Not right for this venture — archive it. */
export const discardWisdom = mutation({
    args: { itemId: v.id("sharedItems") },
    returns: v.object({ ok: v.boolean() }),
    handler: async (ctx, args) => {
        await assertCanAct(ctx);
        const item = await ctx.db.get(args.itemId);
        if (!item) throw new Error("Shared item not found");
        await ctx.db.patch(item._id, { status: "archived" });
        return { ok: true };
    },
});

/** Wisdom for one venture, newest first, with measured outcomes. */
export const wisdomForVenture = query({
    args: { ventureId: v.id("ventures") },
    returns: v.array(wisdomItemValidator),
    handler: async (ctx, args) => {
        const items = await ctx.db
            .query("sharedItems")
            .withIndex("by_ventureId_and_status", (q) => q.eq("ventureId", args.ventureId))
            .order("desc")
            .take(10);
        const visible = items.filter((row) => row.status !== "archived").slice(0, 6);

        const withOutcome = [];
        for (const row of visible) {
            let outcomeValue: number | null = null;
            if (row.status === "applied") {
                const checkIns = await ctx.db
                    .query("kpiCheckIns")
                    .withIndex("by_ventureId", (q) => q.eq("ventureId", args.ventureId))
                    .take(200);
                outcomeValue = checkIns
                    .filter((c) => c.appliedItemId === row._id)
                    .reduce((sum, c) => sum + c.value, 0);
            }
            withOutcome.push({
                id: row._id,
                kind: row.kind,
                sourceUrl: row.sourceUrl ?? null,
                title: row.title ?? null,
                body: row.body,
                charCount: row.charCount,
                status: row.status,
                parse: row.parse,
                appliedAt: row.appliedAt ?? null,
                outcomeValue,
                createdAt: row.createdAt,
            });
        }
        return withOutcome;
    },
});

/** Applied wisdom for the venture owner (entrepreneur surface). */
export const wisdomForOwner = query({
    args: { ventureId: v.id("ventures") },
    returns: v.array(wisdomItemValidator),
    handler: async (ctx, args) => {
        const items = await ctx.db
            .query("sharedItems")
            .withIndex("by_ventureId_and_status", (q) =>
                q.eq("ventureId", args.ventureId).eq("status", "applied")
            )
            .order("desc")
            .take(5);

        return items.map((row) => ({
            id: row._id,
            kind: row.kind,
            sourceUrl: row.sourceUrl ?? null,
            title: row.title ?? null,
            body: row.body,
            charCount: row.charCount,
            status: row.status,
            parse: row.parse,
            appliedAt: row.appliedAt ?? null,
            outcomeValue: null,
            createdAt: row.createdAt,
        }));
    },
});

// --- Parse pipeline (action context has no db; internal bridges below) ---

type ParsePayload = {
    summary: string;
    principles: string[];
    application: { title: string; body: string };
    confidence: number;
    engine: "gemini" | "fallback";
};

/** Action-facing read: item + venture context for the prompt. */
export const getItemForParse = internalQuery({
    args: { itemId: v.id("sharedItems") },
    returns: v.union(
        v.object({
            kind: sharedKindValidator,
            sourceUrl: v.union(v.string(), v.null()),
            body: v.string(),
            venture: v.object({
                name: v.string(),
                craftText: v.string(),
                summary: v.string(),
                kpiLabel: v.string(),
                kpiTarget: v.number(),
            }),
        }),
        v.null()
    ),
    handler: async (ctx, args) => {
        const item = await ctx.db.get(args.itemId);
        if (!item) return null;
        const venture = await ctx.db.get(item.ventureId);
        if (!venture) return null;
        return {
            kind: item.kind,
            sourceUrl: item.sourceUrl ?? null,
            body: item.body,
            venture: {
                name: venture.name,
                craftText: venture.craftText,
                summary: venture.summary,
                kpiLabel: venture.kpiLabel,
                kpiTarget: venture.kpiTarget,
            },
        };
    },
});

export const completeParse = internalMutation({
    args: {
        itemId: v.id("sharedItems"),
        title: v.string(),
        body: v.string(),
        parse: parseValidator,
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await ctx.db.patch(args.itemId, {
            title: args.title,
            body: args.body,
            charCount: args.body.length,
            parse: args.parse,
            status: "parsed",
        });
        return null;
    },
});

/** Fetch a URL and reduce it to readable text (no new dependencies). */
async function fetchReadableText(url: string): Promise<string> {
    const response = await fetch(url, {
        headers: { "User-Agent": "JuaKaliAgent/1.0 (+https://juakaliapp.netlify.app)" },
    });
    if (!response.ok) throw new Error(`Could not fetch link (${response.status})`);
    const html = (await response.text()).slice(0, 400_000);
    const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim();
    if (text.length < 80) throw new Error("Link had no readable text");
    return text.slice(0, 24_000);
}

/** Jua reads the shared wisdom and proposes how to apply it. */
async function parseWithGemini(content: string, venture: {
    name: string;
    craftText: string;
    summary: string;
    kpiLabel: string;
    kpiTarget: number;
}): Promise<ParsePayload | null> {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) return null;

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [
                            {
                                text: `You are Jua, a mentor agent for Kenyan informal-sector ventures. A mentor shared the content below with one specific venture. Distill it into advice that founder can act on this week. Return only valid JSON.

Venture: ${venture.name} (${venture.craftText}, ${venture.summary})
KPI: ${venture.kpiLabel}, target ${venture.kpiTarget}.
Shared content: ${content}`,
                            },
                        ],
                    },
                ],
                generationConfig: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: "object",
                        properties: {
                            title: { type: "string" },
                            summary: { type: "string" },
                            principles: { type: "array", items: { type: "string" } },
                            applicationTitle: { type: "string" },
                            applicationBody: { type: "string" },
                            confidence: { type: "number" },
                        },
                        required: ["title", "summary", "principles", "applicationTitle", "applicationBody", "confidence"],
                    },
                },
            }),
        }
    );
    if (!response.ok) return null;
    const json = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
    if (!text) return null;
    try {
        const parsed = JSON.parse(text) as {
            title?: string;
            summary?: string;
            principles?: unknown;
            applicationTitle?: string;
            applicationBody?: string;
            confidence?: number;
        };
        const principles = Array.isArray(parsed.principles)
            ? parsed.principles.filter((p): p is string => typeof p === "string" && p.trim().length > 0).slice(0, 3)
            : [];
        if (!parsed.summary || !parsed.applicationTitle || !parsed.applicationBody) return null;
        return {
            summary: parsed.summary.slice(0, 400),
            principles: principles.map((p) => p.slice(0, 160)),
            application: {
                title: parsed.applicationTitle.slice(0, 120),
                body: parsed.applicationBody.slice(0, 600),
            },
            confidence: Math.min(1, Math.max(0, typeof parsed.confidence === "number" ? parsed.confidence : 0.7)),
            engine: "gemini",
        };
    } catch {
        return null;
    }
}

/** Deterministic parse so the demo never stalls without an API key. */
function fallbackParse(content: string, kind: string): ParsePayload {
    const firstSentence = content.split(/[.!?]/).find((s) => s.trim().length > 20) ?? content.slice(0, 120);
    return {
        summary: `Jua read the ${kind} — essence: ${firstSentence.trim().slice(0, 200)}.`,
        principles: [
            "Pick one change the venture can run this week",
            "Tie it to the KPI the mentor already tracks",
            "Report the result at the next check-in",
        ],
        application: {
            title: "Run one idea from this for a week",
            body: "Choose the single most relevant idea from what your mentor shared and apply it for one week. Jua will measure the KPI movement against it and report back to your mentor with the delta.",
        },
        confidence: 0.55,
        engine: "fallback",
    };
}

export const parseSharedItem = internalAction({
    args: { itemId: v.id("sharedItems") },
    returns: v.null(),
    handler: async (ctx, args) => {
        const item = await ctx.runQuery(internal.wisdom.getItemForParse, { itemId: args.itemId });
        if (!item) return null;

        try {
            let content = item.body;
            if (item.sourceUrl && content.length < 200) {
                try {
                    content = await fetchReadableText(item.sourceUrl);
                } catch {
                    // Keep whatever text the mentor typed; note the fetch failed.
                    content = content || `Shared link: ${item.sourceUrl}`;
                }
            }
            if (!content || content.trim().length < 20) {
                content = content || `Shared ${item.kind}`;
            }

            const parsed =
                (await parseWithGemini(content, item.venture)) ?? fallbackParse(content, item.kind);

            const title =
                item.kind === "podcast"
                    ? "Podcast shared by your mentor"
                    : item.kind === "article"
                      ? "Article shared by your mentor"
                      : item.kind === "voice"
                        ? "Voice note from your mentor"
                        : "Note from your mentor";

            await ctx.runMutation(internal.wisdom.completeParse, {
                itemId: args.itemId,
                title,
                body: content.slice(0, 24_000),
                parse: parsed,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : "Parse failed";
            await ctx.runMutation(internal.wisdom.completeParse, {
                itemId: args.itemId,
                title: "Shared with Jua",
                body: item.body,
                parse: fallbackParse(item.body || message, item.kind),
            });
        }
        return null;
    },
});
