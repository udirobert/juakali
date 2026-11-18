/**
 * M-PESA adapter — the first PaymentRail (Kenya).
 *
 * Phase A/B: read-only statement verification. Parses M-PESA confirmation
 * formats (SMS confirmation text or exported statement lines) into
 * structured third-party evidence for the verification ladder.
 *
 * Typical M-PESA confirmation shapes:
 *   "QK47HX2K9P Confirmed. Ksh1,250.00 sent to AMINA OWEN on 18/11/2026 at 2:31 PM."
 *   "SBK7Q... Confirmed. Ksh15,000.00 received from JOHN DOE on 17/11/2026."
 *
 * Settlement (initiateTransfer) intentionally refuses until the regulated
 * partner track lands — see rails/types.ts.
 */
import type { PaymentRail, ThirdPartyEvidence } from "./types";

const CONFIRMED_RE =
    /([A-Z0-9]{8,12})\s+Confirmed\.?\s*K(?:sh|ES)?\s*([\d,]+(?:\.\d{1,2})?)\s*(sent to|received from)\s+(.+?)(?:\s+on\s+(\d{1,2}\/\d{1,2}\/\d{2,4}))?/i;

function parseOccurredAt(raw: string | undefined): number | null {
    if (!raw) return null;
    const [day, month, year] = raw.split("/").map((part) => Number(part));
    if (!day || !month || !year) return null;
    const fullYear = year < 100 ? 2000 + year : year;
    const ts = Date.UTC(fullYear, month - 1, day);
    return Number.isFinite(ts) ? ts : null;
}

export const mpesaRail: PaymentRail = {
    id: "mpesa",
    label: "M-PESA statement",
    currencies: ["KES"],

    async verifyThirdParty({ artifact, currency, expectedAmount }) {
        if (currency !== "KES") return null; // M-PESA is KES-only
        const match = CONFIRMED_RE.exec(artifact);
        if (!match) return null;

        const [, reference, amountRaw, direction, counterparty, dateRaw] = match;
        const amount = Number((amountRaw ?? "").replace(/,/g, ""));
        if (!Number.isFinite(amount) || amount <= 0) return null;
        if (expectedAmount != null && Math.abs(amount - expectedAmount) > 0.01) return null;

        const evidence: ThirdPartyEvidence = {
            amount,
            currency: "KES",
            occurredAt: parseOccurredAt(dateRaw),
            reference: reference ?? "",
            description: `${direction === "sent to" ? "Sent to" : "Received from"} ${(counterparty ?? "").trim()}`,
            rail: "mpesa",
        };
        return evidence;
    },
};
