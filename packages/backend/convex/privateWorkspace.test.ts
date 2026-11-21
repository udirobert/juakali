/**
 * Private backer–venture-lead workspace — membership, invite, and the
 * four-Friday loop. Industry-agnostic: the tracked measure is free text.
 *
 * Guards covered:
 *  - verified email users only (signed-out / unverified / anonymous rejected);
 *  - invites show only a consent preview to the invitee — nothing else leaks;
 *  - self-invite, wrong-email, cross-account, and cross-workspace attempts fail;
 *  - invite correction retargets cleanly before acceptance;
 *  - zero/decimal values, quiet weeks, help asks, responses, outcomes behave;
 *  - measure label/unit and pricing focus flow into asks and Friday briefs;
 *  - nothing here writes to the public ledger, commitments, or agent runs;
 *  - the whole feature is closed while the demo inbox env is on.
 */
import { convexTest } from "convex-test";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import type { Id } from "./_generated/dataModel";

// ./env snapshots process.env at module load; SOFT_AUTH_INBOX is toggled
// per-test below via a hoisted flag, so give the module a live getter.
const softAuthInbox = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("./env", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./env")>();
    return {
        ...actual,
        env: {
            ...actual.env,
            get SOFT_AUTH_INBOX() {
                return softAuthInbox.value;
            },
        },
    };
});

function initTest() {
    const t = convexTest(schema, import.meta.glob("./**/*.*s"));
    registerRateLimiter(t);
    return t;
}

type TestApp = ReturnType<typeof initTest>;

async function createUser(
    t: TestApp,
    email: string,
    opts?: { verified?: boolean; anonymous?: boolean }
) {
    const userId = await t.run((ctx) =>
        ctx.db.insert("users", {
            email,
            name: email.split("@")[0],
            isAnonymous: opts?.anonymous ?? false,
            emailVerificationTime:
                opts?.verified === false ? undefined : Date.now(),
        })
    );
    return {
        userId,
        email,
        asUser: t.withIdentity({
            subject: `${userId}|session`,
            tokenIdentifier: `test|${userId}|session`,
            issuer: "test",
        }),
    };
}

const CATERING = {
    label: "Paid catering bookings",
    unit: "bookings",
    precision: "whole" as const,
};
const WELDING = {
    label: "Completed jobs",
    unit: "jobs",
    precision: "whole" as const,
};
const BILLABLE = {
    label: "Billable time",
    unit: "hours",
    precision: "decimal" as const,
};

async function createWorkspace(
    backer: { asUser: ReturnType<TestApp["withIdentity"]> },
    opts?: {
        leadEmail?: string;
        measure?: { label: string; unit: string; precision: "whole" | "decimal" };
        pricingFocus?: string;
        relationship?: string;
        supportKind?: "undecided" | "gift" | "loan" | "revenue_share";
        budgetKes?: number;
    }
) {
    return await backer.asUser.mutation(api.privateWorkspace.create, {
        name: "Njoroge Workshop",
        leadEmail: opts?.leadEmail ?? "lead@test.com",
        measure: opts?.measure ?? CATERING,
        pricingFocus: opts?.pricingFocus,
        relationship: opts?.relationship,
        supportKind: opts?.supportKind,
        budgetKes: opts?.budgetKes,
    });
}

async function acceptAsLead(
    t: TestApp,
    lead: { asUser: ReturnType<TestApp["withIdentity"]> },
    workspaceId: Id<"privateWorkspaces">
) {
    await lead.asUser.mutation(api.privateWorkspace.accept, { workspaceId });
}

async function drain(t: TestApp) {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
}

beforeEach(() => {
    // Land mid-week so the first Friday is deterministic but not immediate.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-06T09:00:00Z")); // Monday
});
afterEach(() => {
    vi.useRealTimers();
    softAuthInbox.value = undefined;
});

describe("access gating", () => {
    test("signed-out, unverified, and anonymous users get no workspace", async () => {
        const t = initTest();
        expect(await t.query(api.privateWorkspace.desk, {})).toEqual({
            state: "signedout",
        });

        const unverified = await createUser(t, "new@test.com", { verified: false });
        expect(
            await unverified.asUser.query(api.privateWorkspace.desk, {})
        ).toEqual({ state: "verify" });

        const anon = await createUser(t, "ghost@test.com", { anonymous: true });
        expect(await anon.asUser.query(api.privateWorkspace.desk, {})).toEqual({
            state: "verify",
        });

        await expect(
            unverified.asUser.mutation(api.privateWorkspace.create, {
                name: "N",
                leadEmail: "lead@test.com",
                measure: CATERING,
            })
        ).rejects.toThrow(/verified email/i);
    });

    test("demo inbox env closes the whole feature", async () => {
        softAuthInbox.value = "1";
        const t = initTest();
        const backer = await createUser(t, "aunt@test.com");
        expect(await backer.asUser.query(api.privateWorkspace.desk, {})).toEqual({
            state: "disabled",
        });
        await expect(
            backer.asUser.mutation(api.privateWorkspace.create, {
                name: "N",
                leadEmail: "lead@test.com",
                measure: CATERING,
            })
        ).rejects.toThrow(/unavailable|verified/i);
    });
});

describe("invitations", () => {
    test("create validates fields and rejects self-invite", async () => {
        const t = initTest();
        const backer = await createUser(t, "aunt@test.com");
        const base = {
            name: "N",
            leadEmail: "lead@test.com",
            measure: CATERING,
        };
        await expect(
            backer.asUser.mutation(api.privateWorkspace.create, {
                ...base,
                name: "",
            })
        ).rejects.toThrow(/1–80/i);
        await expect(
            backer.asUser.mutation(api.privateWorkspace.create, {
                ...base,
                leadEmail: "not-an-email",
            })
        ).rejects.toThrow(/valid email/i);
        await expect(
            backer.asUser.mutation(api.privateWorkspace.create, {
                ...base,
                leadEmail: "AUNT@test.com",
            })
        ).rejects.toThrow(/yourself/i);
        await expect(
            backer.asUser.mutation(api.privateWorkspace.create, {
                ...base,
                measure: { label: "", unit: "jobs", precision: "whole" },
            })
        ).rejects.toThrow(/label/i);
        await expect(
            backer.asUser.mutation(api.privateWorkspace.create, {
                ...base,
                measure: { label: "Jobs", unit: "   ", precision: "whole" },
            })
        ).rejects.toThrow(/unit/i);
        // A budget is refused without a funding understanding.
        await expect(
            backer.asUser.mutation(api.privateWorkspace.create, {
                ...base,
                budgetKes: 5000,
            })
        ).rejects.toThrow(/support/i);
        await expect(
            backer.asUser.mutation(api.privateWorkspace.create, {
                ...base,
                supportKind: "gift",
                budgetKes: -50,
            })
        ).rejects.toThrow(/whole amount/i);
    });

    test("invitee sees only a consent preview — no financials or notes", async () => {
        const t = initTest();
        const backer = await createUser(t, "aunt@test.com");
        const lead = await createUser(t, "lead@test.com");
        const stranger = await createUser(t, "stranger@test.com");
        await backer.asUser.mutation(api.privateWorkspace.create, {
            name: "Njoroge Workshop",
            leadEmail: "lead@test.com",
            measure: CATERING,
            supportKind: "revenue_share",
            budgetKes: 20000,
            relationship: "aunt",
            pricingFocus: "ingredient costs for one dish",
        });

        const desk = await lead.asUser.query(api.privateWorkspace.desk, {});
        expect(desk.state).toBe("lobby");
        if (desk.state !== "lobby") throw new Error("unreachable");
        expect(desk.invites).toHaveLength(1);
        expect(desk.invites[0]).toEqual({
            id: desk.invites[0]!.id,
            name: "Njoroge Workshop",
            backerLabel: "aunt@test.com",
        });
        // Consent preview must not carry financials, weeks, or membership.
        expect(Object.keys(desk.invites[0]!).sort()).toEqual([
            "backerLabel",
            "id",
            "name",
        ]);

        const other = await stranger.asUser.query(api.privateWorkspace.desk, {});
        expect(other.state).toBe("lobby");
        if (other.state !== "lobby") throw new Error("unreachable");
        expect(other.invites).toHaveLength(0);
    });

    test("wrong email cannot accept; pending invite can be corrected", async () => {
        const t = initTest();
        const backer = await createUser(t, "aunt@test.com");
        const wrong = await createUser(t, "wrong@test.com");
        const lead = await createUser(t, "lead@test.com");
        const { workspaceId } = await createWorkspace(backer);

        await expect(
            wrong.asUser.mutation(api.privateWorkspace.accept, { workspaceId })
        ).rejects.toThrow(/not addressed to you/i);

        // Backer corrects the address — the old invite stops working.
        await backer.asUser.mutation(api.privateWorkspace.changeInvite, {
            workspaceId,
            leadEmail: "LEAD@test.com",
        });
        await acceptAsLead(t, lead, workspaceId);
        const desk = await lead.asUser.query(api.privateWorkspace.desk, {});
        expect(desk.state).toBe("home");
        if (desk.state === "home") {
            expect(desk.role).toBe("lead");
            expect(desk.weeks).toHaveLength(4);
        }
    });

    test("only the backer can correct, and not after acceptance", async () => {
        const t = initTest();
        const backer = await createUser(t, "aunt@test.com");
        const other = await createUser(t, "other@test.com");
        const lead = await createUser(t, "lead@test.com");
        const { workspaceId } = await createWorkspace(backer);
        await expect(
            other.asUser.mutation(api.privateWorkspace.changeInvite, {
                workspaceId,
                leadEmail: "x@test.com",
            })
        ).rejects.toThrow(/not yours/i);
        await acceptAsLead(t, lead, workspaceId);
        await expect(
            backer.asUser.mutation(api.privateWorkspace.changeInvite, {
                workspaceId,
                leadEmail: "x@test.com",
            })
        ).rejects.toThrow(/already joined/i);
    });
});

describe("the four-Friday loop", () => {
    test("acceptance lands the next Friday 15:00 UTC and schedules four weeks", async () => {
        const t = initTest();
        const backer = await createUser(t, "aunt@test.com");
        const lead = await createUser(t, "lead@test.com");
        const { workspaceId } = await createWorkspace(backer);
        await acceptAsLead(t, lead, workspaceId);

        const ws = await t.run((ctx) => ctx.db.get(workspaceId));
        // Monday 2025-01-06 → first deadline Friday 2025-01-10 15:00 UTC.
        expect(ws?.firstFriday).toBe(new Date("2025-01-10T15:00:00Z").getTime());
        const weeks = await t.run((ctx) =>
            ctx.db
                .query("privateWorkspaceWeeks")
                .withIndex("by_workspace_week", (q) =>
                    q.eq("workspaceId", workspaceId)
                )
                .collect()
        );
        expect(weeks.map((w) => w.week).sort()).toEqual([1, 2, 3, 4]);
        for (const w of weeks) {
            expect(w.deadline).toBe(ws!.firstFriday! + (w.week - 1) * 7 * 86400000);
        }
    });

    test("exact-boundary Friday: before 15:00 that day, after rolls to next week", async () => {
        const t = initTest();
        const backer = await createUser(t, "aunt@test.com");
        const lead = await createUser(t, "lead@test.com");
        const { workspaceId } = await createWorkspace(backer);

        // Friday 10:00 UTC — today's 15:00 deadline is still ahead.
        vi.setSystemTime(new Date("2025-01-10T10:00:00Z"));
        await acceptAsLead(t, lead, workspaceId);
        let ws = await t.run((ctx) => ctx.db.get(workspaceId));
        expect(ws?.firstFriday).toBe(new Date("2025-01-10T15:00:00Z").getTime());

        // Friday 16:00 UTC — this Friday has passed; first deadline next week.
        const backer2 = await createUser(t, "aunt2@test.com");
        const lead2 = await createUser(t, "lead2@test.com");
        const w2 = await createWorkspace(backer2, { leadEmail: "lead2@test.com" });
        vi.setSystemTime(new Date("2025-01-10T16:00:00Z"));
        await acceptAsLead(t, lead2, w2.workspaceId);
        ws = await t.run((ctx) => ctx.db.get(w2.workspaceId));
        expect(ws?.firstFriday).toBe(new Date("2025-01-17T15:00:00Z").getTime());
    });

    test("zero value + explicit ask: visible immediately, responded, outcome", async () => {
        const t = initTest();
        const backer = await createUser(t, "aunt@test.com");
        const leadUser = await createUser(t, "lead@test.com");
        const { workspaceId: wsId } = await createWorkspace(backer);
        await acceptAsLead(t, leadUser, wsId);

        // Only the lead reports; the backer cannot.
        await expect(
            backer.asUser.mutation(api.privateWorkspace.report, {
                value: 0,
                note: "Quiet week",
            })
        ).rejects.toThrow(/lead/i);

        await leadUser.asUser.mutation(api.privateWorkspace.report, {
            value: 0,
            note: "No bookings yet — pricing the menu.",
            ask: "Could you look at my ingredient costs for the pilau?",
            requestKind: "pricing",
        });

        // Duplicate submit is blocked.
        await expect(
            leadUser.asUser.mutation(api.privateWorkspace.report, {
                value: 1,
                note: "x",
            })
        ).rejects.toThrow(/already submitted/i);

        // Backer sees the ask immediately even though the week is open —
        // with the pricing suggestion built from the pair's own focus.
        const desk = await backer.asUser.query(api.privateWorkspace.desk, {});
        if (desk.state !== "home") throw new Error("expected home");
        expect(desk.openAsk).not.toBeNull();
        expect(desk.openAsk!.requestKind).toBe("pricing");

        // Lead cannot answer their own ask; cross-account cannot either.
        const stranger = await createUser(t, "s@test.com");
        const w2 = await createWorkspace(stranger, { leadEmail: "l2@test.com" });
        const lead2 = await createUser(t, "l2@test.com");
        await acceptAsLead(t, lead2, w2.workspaceId);
        await expect(
            leadUser.asUser.mutation(api.privateWorkspace.respond, {
                weekId: desk.openAsk!.weekId,
                choice: "help",
            })
        ).rejects.toThrow(/backer/i);
        await expect(
            stranger.asUser.mutation(api.privateWorkspace.respond, {
                weekId: desk.openAsk!.weekId,
                choice: "help",
            })
        ).rejects.toThrow(/your workspace/i);

        await backer.asUser.mutation(api.privateWorkspace.respond, {
            weekId: desk.openAsk!.weekId,
            choice: "help",
        });
        await expect(
            backer.asUser.mutation(api.privateWorkspace.respond, {
                weekId: desk.openAsk!.weekId,
                choice: "pass",
            })
        ).rejects.toThrow(/already answered/i);

        // Cross-workspace outcome attempt fails, then honest feedback works.
        await expect(
            lead2.asUser.mutation(api.privateWorkspace.outcome, {
                weekId: desk.openAsk!.weekId,
                result: "helped",
            })
        ).rejects.toThrow(/your workspace/i);
        await leadUser.asUser.mutation(api.privateWorkspace.outcome, {
            weekId: desk.openAsk!.weekId,
            result: "not_yet",
        });
        // "not_yet" may later become "helped" — never back again.
        await leadUser.asUser.mutation(api.privateWorkspace.outcome, {
            weekId: desk.openAsk!.weekId,
            result: "helped",
        });
        await expect(
            leadUser.asUser.mutation(api.privateWorkspace.outcome, {
                weekId: desk.openAsk!.weekId,
                result: "not_yet",
            })
        ).rejects.toThrow(/already marked/i);
    });

    test("a report without an ask stays private until Friday, then briefs", async () => {
        const t = initTest();
        const backer = await createUser(t, "aunt@test.com");
        const lead = await createUser(t, "lead@test.com");
        const { workspaceId } = await createWorkspace(backer);
        await acceptAsLead(t, lead, workspaceId);

        await lead.asUser.mutation(api.privateWorkspace.report, {
            value: 12,
            note: "Good lunch trade on Tuesday.",
        });

        // Backer knows a report exists but cannot read it mid-week.
        let desk = await backer.asUser.query(api.privateWorkspace.desk, {});
        if (desk.state !== "home") throw new Error("expected home");
        const w1 = desk.weeks.find((w) => w.week === 1)!;
        expect(w1.report).toBeNull();
        expect(w1.reportPending).toBe(true);
        expect(w1.brief).toBeNull();
        expect(desk.openAsk).toBeNull();

        // A quiet week later closes with "No check-in received", never a 0.
        const weeks = await t.run((ctx) =>
            ctx.db
                .query("privateWorkspaceWeeks")
                .withIndex("by_workspace_week", (q) =>
                    q.eq("workspaceId", workspaceId)
                )
                .collect()
        );
        const week1Row = weeks.find((w) => w.week === 1)!;
        const week2 = weeks.find((w) => w.week === 2)!;

        // Advance past week 2's deadline, then run the same idempotent close
        // the scheduler fires for each elapsed week (weeks 3–4 stay open).
        vi.setSystemTime(new Date(week2.deadline + 60_000));
        await t.mutation(internal.privateWorkspace.closeWeek, {
            weekId: week1Row._id,
        });
        await t.mutation(internal.privateWorkspace.closeWeek, { weekId: week2._id });
        // A still-future week must refuse to close early.
        const week3 = weeks.find((w) => w.week === 3)!;
        await t.mutation(internal.privateWorkspace.closeWeek, { weekId: week3._id });

        desk = await backer.asUser.query(api.privateWorkspace.desk, {});
        if (desk.state !== "home") throw new Error("expected home");
        const closed1 = desk.weeks.find((w) => w.week === 1)!;
        const closed2 = desk.weeks.find((w) => w.week === 2)!;
        expect(closed1.closed).toBe(true);
        expect(closed1.report!.value).toBe(12);
        expect(closed1.brief).toContain(
            "No help requested. No action needed."
        );
        expect(closed1.brief![0]).toBe(
            "Venture lead reported Paid catering bookings: 12 bookings. Good lunch trade on Tuesday."
        );
        expect(closed2.brief).toEqual(["No check-in received."]);
        // Weeks 3–4 are still open.
        expect(desk.weeks.filter((w) => w.closed)).toHaveLength(2);
    });

    test("nothing workspace-side touches the public ledger, commitments, or runs", async () => {
        const t = initTest();
        const backer = await createUser(t, "aunt@test.com");
        const lead = await createUser(t, "lead@test.com");
        await createWorkspace(backer).then(async ({ workspaceId }) => {
            await acceptAsLead(t, lead, workspaceId);
        });
        await lead.asUser.mutation(api.privateWorkspace.report, {
            value: 3,
            note: "Three lunch orders.",
            ask: "Introduce me to the church catering lead?",
            requestKind: "introduction",
        });
        const desk = await backer.asUser.query(api.privateWorkspace.desk, {});
        if (desk.state !== "home") throw new Error("expected home");
        await backer.asUser.mutation(api.privateWorkspace.respond, {
            weekId: desk.openAsk!.weekId,
            choice: "talk",
        });
        await drain(t);

        for (const table of ["ledgerEvents", "commitments", "agentRuns"] as const) {
            const rows = await t.run((ctx) => ctx.db.query(table).collect());
            expect(rows).toHaveLength(0);
        }
    });
});

describe("measures and suggestions stay industry-agnostic", () => {
    test("custom pricing focus reaches the ask and the Friday brief", async () => {
        const t = initTest();
        const backer = await createUser(t, "backer@test.com");
        const lead = await createUser(t, "lead@test.com");
        const { workspaceId } = await createWorkspace(backer, {
            measure: CATERING,
            pricingFocus: "flour and oil costs for one traybake",
        });
        await acceptAsLead(t, lead, workspaceId);
        await lead.asUser.mutation(api.privateWorkspace.report, {
            value: 2,
            note: "Two office trays.",
            ask: "Help me reprice the tray menu?",
            requestKind: "pricing",
        });
        const desk = await backer.asUser.query(api.privateWorkspace.desk, {});
        if (desk.state !== "home") throw new Error("expected home");
        expect(desk.openAsk!.suggestion).toBe(
            "Offer to review flour and oil costs for one traybake together."
        );

        // Close the week — the brief carries the same suggested step.
        const week = await t.run((ctx) =>
            ctx.db
                .query("privateWorkspaceWeeks")
                .withIndex("by_workspace_week", (q) =>
                    q.eq("workspaceId", workspaceId)
                )
                .first()
        );
        vi.setSystemTime(new Date(week!.deadline + 60_000));
        await t.mutation(internal.privateWorkspace.closeWeek, { weekId: week!._id });
        const closed = await backer.asUser.query(api.privateWorkspace.desk, {});
        if (closed.state !== "home") throw new Error("expected home");
        expect(closed.weeks[0]!.brief).toContain(
            "Suggested next step — Offer to review flour and oil costs for one traybake together."
        );
    });

    test("a welder's measure and focus never mention kitchens or catering", async () => {
        const t = initTest();
        const backer = await createUser(t, "backer@test.com");
        const lead = await createUser(t, "lead@test.com");
        const { workspaceId } = await createWorkspace(backer, {
            measure: WELDING,
            pricingFocus: "materials and labor for one quote",
            relationship: "mentor",
        });
        await acceptAsLead(t, lead, workspaceId);
        await lead.asUser.mutation(api.privateWorkspace.report, {
            value: 4,
            note: "Four gate repairs.",
            ask: "Check my quote for the stair rail?",
            requestKind: "pricing",
        });
        const desk = await backer.asUser.query(api.privateWorkspace.desk, {});
        if (desk.state !== "home") throw new Error("expected home");
        expect(desk.workspace.measure).toEqual(WELDING);
        expect(desk.workspace.relationship).toBe("mentor");
        expect(desk.openAsk!.suggestion).toBe(
            "Offer to review materials and labor for one quote together."
        );
        const blob = JSON.stringify(desk);
        expect(blob).not.toMatch(/kitchen|chef|catering bookings|dish/i);
    });

    test("bespoke decimal measure accepts 1.5 and 0; whole rejects fractions", async () => {
        const t = initTest();
        const backer = await createUser(t, "backer@test.com");
        const lead = await createUser(t, "lead@test.com");
        const { workspaceId } = await createWorkspace(backer, {
            measure: BILLABLE,
        });
        await acceptAsLead(t, lead, workspaceId);
        await lead.asUser.mutation(api.privateWorkspace.report, {
            value: 1.5,
            note: "Half day on the proposal.",
        });
        const desk = await lead.asUser.query(api.privateWorkspace.desk, {});
        if (desk.state !== "home") throw new Error("expected home");
        expect(desk.weeks[0]!.report!.value).toBe(1.5);

        // Sub-cent values roundtrip exactly — no silent display rounding.
        const backerD = await createUser(t, "bd@test.com");
        const leadD = await createUser(t, "leadd@test.com");
        const wd = await createWorkspace(backerD, {
            leadEmail: "leadd@test.com",
            measure: BILLABLE,
        });
        await acceptAsLead(t, leadD, wd.workspaceId);
        await leadD.asUser.mutation(api.privateWorkspace.report, {
            value: 0.001,
            note: "A quick phone call.",
        });
        const weekD = await t.run((ctx) =>
            ctx.db
                .query("privateWorkspaceWeeks")
                .withIndex("by_workspace_week", (q) =>
                    q.eq("workspaceId", wd.workspaceId)
                )
                .first()
        );
        vi.setSystemTime(new Date(weekD!.deadline + 60_000));
        await t.mutation(internal.privateWorkspace.closeWeek, {
            weekId: weekD!._id,
        });
        const deskD = await backerD.asUser.query(api.privateWorkspace.desk, {});
        if (deskD.state !== "home") throw new Error("expected home");
        expect(deskD.weeks[0]!.brief![0]).toBe(
            "Venture lead reported Billable time: 0.001 hours. A quick phone call."
        );

        // Whole-precision workspace: fractions and bad values rejected.
        const backer2 = await createUser(t, "b2@test.com");
        const lead2 = await createUser(t, "lead2@test.com");
        const w2 = await createWorkspace(backer2, {
            leadEmail: "lead2@test.com",
            measure: { label: "Jobs", unit: "jobs", precision: "whole" },
        });
        await acceptAsLead(t, lead2, w2.workspaceId);
        await expect(
            lead2.asUser.mutation(api.privateWorkspace.report, {
                value: 1.5,
                note: "x",
            })
        ).rejects.toThrow(/whole number/i);
        await expect(
            lead2.asUser.mutation(api.privateWorkspace.report, {
                value: -1,
                note: "x",
            })
        ).rejects.toThrow(/positive|whole/i);
        await expect(
            lead2.asUser.mutation(api.privateWorkspace.report, {
                value: Number.NaN,
                note: "x",
            })
        ).rejects.toThrow();
        // Zero is a real report, not an absence.
        await lead2.asUser.mutation(api.privateWorkspace.report, {
            value: 0,
            note: "No jobs this week.",
        });
        const desk2 = await lead2.asUser.query(api.privateWorkspace.desk, {});
        if (desk2.state !== "home") throw new Error("expected home");
        expect(desk2.weeks[0]!.report!.value).toBe(0);
    });

    test("no pricing focus falls back to a neutral suggestion", async () => {
        const t = initTest();
        const backer = await createUser(t, "backer@test.com");
        const lead = await createUser(t, "lead@test.com");
        const { workspaceId } = await createWorkspace(backer, { measure: WELDING });
        await acceptAsLead(t, lead, workspaceId);
        await lead.asUser.mutation(api.privateWorkspace.report, {
            value: 1,
            note: "One quote pending.",
            ask: "Is my quote right?",
            requestKind: "pricing",
        });
        const desk = await backer.asUser.query(api.privateWorkspace.desk, {});
        if (desk.state !== "home") throw new Error("expected home");
        expect(desk.openAsk!.suggestion).toBe(
            "Review the costs and price of one piece of work together."
        );
    });

    test("funding understanding is optional and omitted by default", async () => {
        const t = initTest();
        const backer = await createUser(t, "backer@test.com");
        const lead = await createUser(t, "lead@test.com");
        const { workspaceId } = await createWorkspace(backer);
        const ws = await t.run((ctx) => ctx.db.get(workspaceId));
        expect(ws!.supportKind).toBeUndefined();
        expect(ws!.budgetKes).toBeUndefined();
        expect(ws!.relationship).toBeUndefined();
        await acceptAsLead(t, lead, workspaceId);
        const desk = await lead.asUser.query(api.privateWorkspace.desk, {});
        if (desk.state !== "home") throw new Error("expected home");
        expect(desk.workspace.supportKind).toBeNull();
        expect(desk.workspace.budgetKes).toBeNull();
    });

    test("feedback requests get their own suggestion", async () => {
        const t = initTest();
        const backer = await createUser(t, "backer@test.com");
        const lead = await createUser(t, "lead@test.com");
        const { workspaceId } = await createWorkspace(backer);
        await acceptAsLead(t, lead, workspaceId);
        await lead.asUser.mutation(api.privateWorkspace.report, {
            value: 2,
            note: "Two drafts done.",
            ask: "Could you read the proposal draft?",
            requestKind: "feedback",
        });
        const desk = await backer.asUser.query(api.privateWorkspace.desk, {});
        if (desk.state !== "home") throw new Error("expected home");
        expect(desk.openAsk!.suggestion).toBe(
            "Offer feedback on one specific piece of work."
        );
    });
});

describe("overview — the minimal card read for Home surfaces", () => {
    test("signed-out, unverified, and disabled states", async () => {
        const t = initTest();
        expect(await t.query(api.privateWorkspace.overview, {})).toEqual({
            state: "signedout",
        });
        const unverified = await createUser(t, "new@test.com", { verified: false });
        expect(await unverified.asUser.query(api.privateWorkspace.overview, {})).toEqual({
            state: "verify",
        });
        softAuthInbox.value = "1";
        const backer = await createUser(t, "b@test.com");
        expect(await backer.asUser.query(api.privateWorkspace.overview, {})).toEqual({
            state: "disabled",
        });
    });

    test("empty for nonmembers — no names, emails, or other workspaces", async () => {
        const t = initTest();
        const backer = await createUser(t, "b@test.com");
        await createWorkspace(backer);
        const stranger = await createUser(t, "s@test.com");
        expect(await stranger.asUser.query(api.privateWorkspace.overview, {})).toEqual({
            state: "empty",
        });
    });

    test("invited advertises only name + multiplicity", async () => {
        const t = initTest();
        const backer = await createUser(t, "b@test.com");
        await createWorkspace(backer);
        const other = await createUser(t, "b2@test.com");
        await other.asUser.mutation(api.privateWorkspace.create, {
            name: "Second Workspace",
            leadEmail: "lead@test.com",
            measure: WELDING,
        });
        const lead = await createUser(t, "lead@test.com");
        const o = await lead.asUser.query(api.privateWorkspace.overview, {});
        expect(o).toEqual({
            state: "invited",
            name: "Njoroge Workshop",
            multiple: true,
        });
        // Nothing private rides along: no emails, budgets, or ids.
        expect(Object.keys(o).sort()).toEqual(["multiple", "name", "state"]);
    });

    test("pending before acceptance, then the lead's report state", async () => {
        const t = initTest();
        const backer = await createUser(t, "b@test.com");
        const lead = await createUser(t, "lead@test.com");
        const { workspaceId } = await createWorkspace(backer);

        expect(await backer.asUser.query(api.privateWorkspace.overview, {})).toEqual({
            state: "pending",
            name: "Njoroge Workshop",
            completed: false,
        });
        // Reading overview must not schedule or mutate anything.
        expect(
            await t.run((ctx) => ctx.db.query("privateWorkspaceWeeks").collect())
        ).toHaveLength(0);

        await acceptAsLead(t, lead, workspaceId);
        const leadView = await lead.asUser.query(api.privateWorkspace.overview, {});
        expect(leadView).toEqual({
            state: "report",
            name: "Njoroge Workshop",
            week: 1,
            completed: false,
        });
        // Backer is quiet — an active week with nothing waiting on them.
        expect(await backer.asUser.query(api.privateWorkspace.overview, {})).toEqual({
            state: "active",
            name: "Njoroge Workshop",
            week: 1,
            completed: false,
        });
    });

    test("backer sees request after a help ask; lead sees feedback after response", async () => {
        const t = initTest();
        const backer = await createUser(t, "b@test.com");
        const lead = await createUser(t, "lead@test.com");
        const { workspaceId } = await createWorkspace(backer);
        await acceptAsLead(t, lead, workspaceId);
        await lead.asUser.mutation(api.privateWorkspace.report, {
            value: 2,
            note: "two",
            ask: "help me price?",
            requestKind: "pricing",
        });
        expect(await backer.asUser.query(api.privateWorkspace.overview, {})).toEqual({
            state: "request",
            name: "Njoroge Workshop",
            week: 1,
            completed: false,
        });

        const desk = await backer.asUser.query(api.privateWorkspace.desk, {});
        if (desk.state !== "home") throw new Error("expected home");
        await backer.asUser.mutation(api.privateWorkspace.respond, {
            weekId: desk.openAsk!.weekId,
            choice: "help",
        });
        expect(await lead.asUser.query(api.privateWorkspace.overview, {})).toEqual({
            state: "feedback",
            name: "Njoroge Workshop",
            week: 1,
            completed: false,
        });
        // The ask content itself never appears in the overview.
        const o = await lead.asUser.query(api.privateWorkspace.overview, {});
        expect(JSON.stringify(o)).not.toContain("help me price");
        expect(JSON.stringify(o)).not.toContain("two");
    });

    test("complete after four Fridays, still flags unresolved work", async () => {
        const t = initTest();
        const backer = await createUser(t, "b@test.com");
        const lead = await createUser(t, "lead@test.com");
        const { workspaceId } = await createWorkspace(backer);
        await acceptAsLead(t, lead, workspaceId);
        // Ask on week 1 that is never answered — completion must not hide it.
        await lead.asUser.mutation(api.privateWorkspace.report, {
            value: 1,
            note: "n",
            ask: "a supplier?",
            requestKind: "supplier",
        });
        const weeks = await t.run((ctx) =>
            ctx.db
                .query("privateWorkspaceWeeks")
                .withIndex("by_workspace_week", (q) => q.eq("workspaceId", workspaceId))
                .collect()
        );
        vi.setSystemTime(new Date(weeks[3]!.deadline + 60_000));
        for (const w of weeks) {
            await t.mutation(internal.privateWorkspace.closeWeek, { weekId: w._id });
        }
        const o = await backer.asUser.query(api.privateWorkspace.overview, {});
        expect(o.state).toBe("request");
        expect(o).toMatchObject({ completed: true, week: 1 });
        // Once answered, completed with nothing outstanding reads complete.
        const desk = await backer.asUser.query(api.privateWorkspace.desk, {});
        if (desk.state !== "home") throw new Error("expected home");
        await backer.asUser.mutation(api.privateWorkspace.respond, {
            weekId: desk.openAsk!.weekId,
            choice: "pass",
        });
        expect(await backer.asUser.query(api.privateWorkspace.overview, {})).toEqual({
            state: "complete",
            name: "Njoroge Workshop",
            completed: true,
        });
    });
});
