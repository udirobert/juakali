/**
 * Manual statement adapter — the universal fallback rail.
 *
 * Works in any market: parses a plain-text bank/statement line into
 * third-party evidence. This is deliberately provider-agnostic so every
 * venture has at least one path to the `third_party` verification rung,
 * even before a local rail adapter exists.
 *
 * Expected shape (one line): "2026-11-17 CREDIT 12500.00 REF XYZ Corp payment"
 * Also accepts "DEBIT"/"DR" (recorded as negative-direction but same amount).
 */
import type { PaymentRail, ThirdPartyEvidence } from "./types";

const LINE_RE =
    /(\d{4}-\d{2}-\d{2})\s+(CREDIT|DEBIT|CR|DR)\s+([\d,]+(?:\.\d{1,2})?)\s*(?:REF\s*:?\s*)?(\S+)?\s*(.*)/i;

export const manualStatementRail: PaymentRail = {
    id: "manual_statement",
    label: "Bank statement",
    currencies: ["KES", "USD", "NGN", "GHS", "PHP", "IDR", "INR", "BRL", "ZAR"],

    async verifyThirdParty({ artifact, currency, expectedAmount }) {
        const match = LINE_RE.exec(artifact);
        if (!match) return null;

        const [, dateRaw, direction, amountRaw, reference, rest] = match;
        const amount = Number((amountRaw ?? "").replace(/,/g, ""));
        if (!Number.isFinite(amount) || amount <= 0) return null;
        if (expectedAmount != null && Math.abs(amount - expectedAmount) > 0.01) return null;

        const occurredAt = Date.parse(`${dateRaw}T00:00:00Z`);
        const evidence: ThirdPartyEvidence = {
            amount,
            currency,
            occurredAt: Number.isFinite(occurredAt) ? occurredAt : null,
            reference: reference ?? "",
            description: `${direction.toUpperCase()}${rest?.trim() ? ` — ${rest.trim().slice(0, 120)}` : ""}`,
            rail: "manual_statement",
        };
        return evidence;
    },
};
