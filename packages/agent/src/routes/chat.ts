import { Router } from "express";
import { runAgent } from "../agent.js";

const router = Router();

/**
 * POST /chat
 * Body: { message: string }
 * Header: Authorization: Bearer <AGENT_CHAT_TOKEN>
 *
 * The agent runs the standard Gemini 3.6 Flash + Convex tool loop.
 * A bearer token is required so the deployed URL is not a free Gemini proxy.
 * AGENT_CHAT_TOKEN must be set as a Cloud Run env var; if it is unset, every
 * request is rejected so misconfigured deploys fail loudly.
 */
router.post("/", async (req, res) => {
    const expected = process.env.AGENT_CHAT_TOKEN;
    if (!expected) {
        return res.status(503).json({
            error: "AGENT_CHAT_TOKEN is not configured on the server.",
        });
    }
    const header = req.header("authorization");
    const presented = header?.startsWith("Bearer ")
        ? header.slice("Bearer ".length).trim()
        : null;
    if (!presented || presented !== expected) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const message =
        typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message) {
        return res.status(400).json({ error: "message is required" });
    }

    try {
        const text = await runAgent(message);
        return res.json({ message, reply: text });
    } catch (error) {
        const detail = error instanceof Error ? error.message : "Unknown error";
        return res.status(500).json({ error: "Agent run failed", detail });
    }
});

export const chatRouter = router;
