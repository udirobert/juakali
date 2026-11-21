/**
 * Pure copy helpers: public pledge summary, revenue-only projection, and
 * truthful ledger presentation. No Convex test harness needed — these are
 * plain functions.
 */
import { describe, expect, test } from "vitest";
import {
    evidenceTagLabel,
    formatPublicPledge,
    ledgerNetwork,
    publicLedgerSummary,
    reportedRevenueKes,
} from "./publicCopy";

describe("formatPublicPledge", () => {
    test("returns the exact public summary template", () => {
        expect(formatPublicPledge("Alice", "KES", 10_000, "Brian Welding Bench")).toBe(
            "Alice pledged KES 10,000 into Brian Welding Bench (10.0% until 2×)"
        );
    });
    test("rounds the amount and honours custom terms", () => {
        expect(formatPublicPledge("Bo", "KES", 1234.6, "V", 500, 3)).toBe(
            "Bo pledged KES 1,235 into V (5.0% until 3×)"
        );
    });
});

describe("reportedRevenueKes", () => {
    const now = 1_000_000;
    const row = (metric: string, value: number, createdAt = now + 10) => ({
        metric,
        value,
        createdAt,
    });

    test("returns null — never money — for jobs and meetings alone", () => {
        expect(
            reportedRevenueKes([row("jobs_completed", 4), row("meetings_booked", 2)], now)
        ).toBeNull();
    });

    test("counts only revenue_kes among mixed metrics", () => {
        expect(
            reportedRevenueKes(
                [row("revenue_kes", 7800), row("jobs_completed", 4), row("revenue_kes", 200)],
                now
            )
        ).toBe(8000);
    });

    test("ignores check-ins recorded before the pledge", () => {
        expect(reportedRevenueKes([row("revenue_kes", 7800, now - 5)], now)).toBeNull();
        expect(
            reportedRevenueKes(
                [row("revenue_kes", 7800, now - 5), row("revenue_kes", 500, now + 5)],
                now
            )
        ).toBe(500);
    });

    test("a reported zero is meaningful — distinct from absent data", () => {
        expect(reportedRevenueKes([row("revenue_kes", 0)], now)).toBe(0);
        expect(reportedRevenueKes([], now)).toBeNull();
    });

    test("a bounded 200-row read cannot establish a complete total", () => {
        const rows = Array.from({ length: 200 }, (_, i) => row("revenue_kes", i));
        expect(reportedRevenueKes(rows, now)).toBeNull();
    });

    test("rejects a dirty set with non-finite or negative revenue", () => {
        expect(reportedRevenueKes([row("revenue_kes", -5)], now)).toBeNull();
        expect(reportedRevenueKes([row("revenue_kes", NaN)], now)).toBeNull();
    });
});

describe("publicLedgerSummary", () => {
    test("strips the Digest for… prefix", () => {
        expect(
            publicLedgerSummary({
                type: "digest",
                summary: "Digest for Brian Welding Bench: Two paid jobs this week.",
            })
        ).toBe("Two paid jobs this week.");
        expect(
            publicLedgerSummary({
                type: "digest",
                summary: "Investor digest for X: All quiet.",
            })
        ).toBe("All quiet.");
    });

    test("labels chipnet transfers as test-network, no real funds", () => {
        expect(
            publicLedgerSummary({
                type: "pledge",
                summary: "Alice funded Brian Welding Bench on-chain — 5,000 sats (chipnet)",
                ventureName: "Brian Welding Bench",
            })
        ).toBe("Brian Welding Bench · Test-network transfer · no real funds moved");
        expect(
            publicLedgerSummary({
                type: "repayment",
                summary: "Repaid on-chain",
                ventureName: "V",
                onchainRef: "https://explorer.example/chipnet/tx/abc",
            })
        ).toBe("V · Test-network transfer · no real funds moved");
    });

    test("chipnet funding with no explorer ref is still a test-network transfer", () => {
        // Legacy system funding rows carry "(chipnet)" in the summary but
        // predate stored references — the explicit marker is the evidence.
        expect(
            publicLedgerSummary({
                type: "pledge",
                summary: "Alice funded V on-chain — 5,000 sats (chipnet)",
                ventureName: "V",
            })
        ).toBe("V · Test-network transfer · no real funds moved");
    });

    test("a pledge into a venture named Chipnet is not a transfer claim", () => {
        const summary = formatPublicPledge("Guest", "KES", 500, "Chipnet Studio");
        expect(
            publicLedgerSummary({ type: "pledge", summary, ventureName: "Chipnet Studio" })
        ).toBe(summary);
    });

    test("a check-in note mentioning chipnet is not a transfer claim", () => {
        const summary = "Chipnet payout failed; paid cash instead.";
        expect(publicLedgerSummary({ type: "checkin", summary })).toBe(summary);
    });

    test("a bare txid is ambiguous — never assumed mainnet", () => {
        expect(
            ledgerNetwork({ type: "pledge", txid: "abc", summary: "Transfer recorded" })
        ).toBeNull();
    });

    test("a system funding line names its network explicitly — even into Chipnet Studio", () => {
        expect(
            ledgerNetwork({
                type: "pledge",
                summary: "System funded Chipnet Studio on-chain — 1,000 sats (mainnet)",
            })
        ).toBe("mainnet");
        expect(
            ledgerNetwork({
                type: "repayment",
                summary: "Venture repaid on-chain (chipnet)",
            })
        ).toBe("chipnet");
    });

    test("leaves mainnet wording unchanged", () => {
        const summary = "Alice funded V on-chain — 5,000 sats";
        expect(
            publicLedgerSummary({ type: "pledge", summary, ventureName: "V" })
        ).toBe(summary);
    });

    test("maps seeded check-in summaries to human-readable lines", () => {
        expect(
            publicLedgerSummary({
                type: "checkin",
                summary: "Brian Welding Bench: revenue_kes = 7,800",
            })
        ).toBe("Brian Welding Bench reported KES 7,800 in revenue");
        expect(
            publicLedgerSummary({
                type: "checkin",
                summary: "Brian Welding Bench: jobs_completed = 2 — good week",
            })
        ).toBe("Brian Welding Bench reported 2 completed jobs — good week");
        expect(
            publicLedgerSummary({
                type: "checkin",
                summary: "Brian Welding Bench: meetings_booked = 3",
            })
        ).toBe("Brian Welding Bench reported 3 meetings booked");
    });

    test("falls back to the raw summary when the format is unknown", () => {
        const summary = "Something unstructured happened";
        expect(publicLedgerSummary({ type: "checkin", summary })).toBe(summary);
    });
});

describe("evidenceTagLabel", () => {
    test("self is founder-reported only for a founder source", () => {
        expect(evidenceTagLabel("self", { founderSource: true })).toBe("Founder reported");
        expect(evidenceTagLabel("self", { founderSource: false })).toBe("Self-reported");
    });
    test("claimed documents are mentions, never verification", () => {
        expect(evidenceTagLabel("verified-photo")).toBe("Photo mentioned");
        expect(evidenceTagLabel("photo-mentioned")).toBe("Photo mentioned");
        expect(evidenceTagLabel("verified-third-party")).toBe("Receipt mentioned");
        expect(evidenceTagLabel("receipt-mentioned")).toBe("Receipt mentioned");
        expect(evidenceTagLabel("statement-text-matched")).toBe("Statement text matched");
    });
});
