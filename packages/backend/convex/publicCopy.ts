/**
 * Pure copy/presentation helpers shared between the Convex backend and the
 * app (`@/convex/publicCopy`). No Convex imports — safe for the frontend.
 */

/** Verbatim public summary template for a soft pledge. */
export function formatPublicPledge(
    name: string,
    currency: string,
    amount: number,
    venture: string,
    shareBps = 1000,
    capMultiple = 2
): string {
    return `${name} pledged ${currency} ${Math.round(amount).toLocaleString("en-KE")} into ${venture} (${(shareBps / 100).toFixed(1)}% until ${capMultiple}×)`;
}

type RevenueRow = { metric: string; value: number; createdAt: number };

/**
 * Sum of self-reported `revenue_kes` check-ins at/after `since`. Returns null
 * when the bounded read cannot establish a complete, clean total — never zero.
 */
export function reportedRevenueKes(rows: readonly RevenueRow[], since: number): number | null {
    if (rows.length >= 200) return null; // bounded read cannot establish complete total
    const revenue = rows.filter((r) => r.createdAt >= since && r.metric === "revenue_kes");
    if (!revenue.length || revenue.some((r) => !Number.isFinite(r.value) || r.value < 0)) return null;
    return revenue.reduce((sum, r) => sum + r.value, 0);
}

const CHECKIN_PATTERN = /^(.+?):\s*([A-Za-z_]+)\s*=\s*(-?[\d.,]+)\s*(?:—\s*(.+))?$/;
const DIGEST_PREFIX = /^(?:Investor digest|Digest)\s+for\s+[^:]+:\s*/i;

function formatKes(value: number): string {
    return `KES ${value.toLocaleString("en-KE")}`;
}

function checkinPhrase(metric: string, value: number): string | null {
    switch (metric) {
        case "revenue_kes":
            return `reported ${formatKes(value)} in revenue`;
        case "jobs_completed":
        case "jobs":
            return `reported ${value.toLocaleString("en-KE")} completed jobs`;
        case "meetings_booked":
        case "meetings":
            return `reported ${value.toLocaleString("en-KE")} meetings booked`;
        default:
            return null;
    }
}

type LedgerLike = {
    type?: string;
    summary: string;
    ventureName?: string | null;
    onchainRef?: string | null;
    txid?: string | null;
    initiator?: string | null;
    evidence?: readonly string[] | null;
};

/**
 * Settlement network for a ledger row, or null when nothing recorded one.
 * "chipnet" is only claimed from explicit transaction evidence — a txid, an
 * explorer reference, an `onchain` tag, or a legacy funding/repayment summary
 * that literally ends "(chipnet)". A venture named "Chipnet Studio" or a
 * check-in note mentioning the word is never a transfer claim.
 */
export function ledgerNetwork(event: LedgerLike): "chipnet" | "mainnet" | null {
    if (event.type !== "pledge" && event.type !== "repayment") return null;
    const ref = event.onchainRef ?? "";
    if (/^https:\/\/[^/]+\/chipnet\/tx\//i.test(ref)) return "chipnet";
    if (/^https:\/\/blockexplorer\.cash\/tx\//i.test(ref)) return "mainnet";
    const match = /(?:\bfunded\b.*\bon-chain\b.*|\brepaid\b.*\bon-chain\s*)\((chipnet|mainnet)\)\s*$/i.exec(event.summary);
    return match ? (match[1].toLowerCase() as "chipnet" | "mainnet") : null;
}

/** True when the row is a test-network transfer — never real funds. */
export function isTestNetworkTransfer(event: LedgerLike): boolean {
    return ledgerNetwork(event) === "chipnet";
}

/** Positive founder provenance — `founder-update` tag or a founder-initiated row. */
export function isFounderSource(event: LedgerLike): boolean {
    return Boolean(event.evidence?.includes("founder-update")) || event.initiator === "founder";
}

/**
 * Human-readable presentation for a public ledger summary. The raw record is
 * never mutated — callers keep it alongside in the detail view.
 */
export function publicLedgerSummary(event: LedgerLike): string {
    const summary = event.summary ?? "";
    const venture = event.ventureName?.trim();

    // Test-network transfers: never imply real funds moved.
    if (isTestNetworkTransfer(event)) {
        return `${venture ? `${venture} · ` : ""}Test-network transfer · no real funds moved`;
    }

    if (event.type === "digest") {
        const stripped = summary.replace(DIGEST_PREFIX, "").trim();
        return stripped || summary;
    }

    // Seeded/legacy check-in summaries: "Name: metric = value — note".
    const match = summary.match(CHECKIN_PATTERN);
    if (match && (event.type === "checkin" || event.type === undefined)) {
        const [, name, metric, rawValue, note] = match;
        const value = Number(rawValue.replace(/,/g, ""));
        if (Number.isFinite(value)) {
            const phrase = checkinPhrase(metric, value);
            if (phrase) return `${name} ${phrase}${note ? ` — ${note}` : ""}`;
        }
    }

    return summary;
}

/**
 * Truthful label for an evidence tag. `verified-*` tags are legacy claims that
 * never implied an independent review — they are labels of mentioned inputs.
 */
export function evidenceTagLabel(tag: string, opts?: { founderSource?: boolean }): string {
    switch (tag) {
        case "self":
        case "self_reported":
            return opts?.founderSource ? "Founder reported" : "Self-reported";
        case "verified-photo":
        case "photo-mentioned":
        case "photo_evidence":
            return "Photo mentioned";
        case "verified-third-party":
        case "receipt-mentioned":
        case "third_party":
            return "Receipt mentioned";
        case "statement-text-matched":
            return "Statement text matched";
        case "investor-entered":
            return "Investor entered";
        default:
            return tag;
    }
}
