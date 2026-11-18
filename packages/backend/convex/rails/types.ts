/**
 * PaymentRail — the settlement/verification provider interface.
 *
 * JuaKali's capital instrument is market-neutral; the *rails* are local.
 * M-PESA is the first implementation (Kenya), but nothing above this
 * interface may reference a specific provider. New markets (Nigeria,
 * Ghana, Philippines, Indonesia…) add an adapter, not a redesign.
 *
 * Two capabilities, mapped to the product's two needs:
 *  - verifyThirdParty: feeds the evidence ladder's `third_party` rung —
 *    parse a statement/transaction reference into a corroborated amount.
 *  - initiateTransfer: the future settlement path (Phase C of the plan —
 *    only after a regulated vehicle is in place).
 *
 * IMPORTANT: settlement stays unimplemented until the regulated-partner
 * track lands. Adapters must refuse transfers (throw) until then.
 */

export type RailId = "mpesa" | "bank_ke" | "paystack" | "gcash" | "manual_statement";

export type ThirdPartyEvidence = {
    /** The corroborated amount in the venture's currency minor-friendly unit. */
    amount: number;
    /** ISO currency the statement is denominated in. */
    currency: string;
    /** When the transaction occurred (ms epoch), if the statement shows it. */
    occurredAt: number | null;
    /** Provider-native reference (M-PESA code, bank ref, etc.). */
    reference: string;
    /** Free-text counterparty/description from the statement. */
    description: string | null;
    /** Which adapter produced this — recorded on the evidence row. */
    rail: RailId;
};

export interface PaymentRail {
    readonly id: RailId;
    /** Human label for evidence tags and UI ("M-PESA statement"). */
    readonly label: string;
    /** ISO currency codes this rail operates in. */
    readonly currencies: string[];
    /**
     * Verify a third-party artifact (statement text, transaction code,
     * parsed PDF text) into structured corroborating evidence.
     * Returns null when the artifact cannot be corroborated — never throws
     * for "not found"; throw only for adapter-internal errors.
     */
    verifyThirdParty(input: {
        /** Raw artifact: statement text, USSD confirmation SMS, PDF text. */
        artifact: string;
        /** Expected currency — adapters must reject mismatches. */
        currency: string;
        /** Optional expected amount to match against. */
        expectedAmount?: number;
    }): Promise<ThirdPartyEvidence | null>;
    /**
     * Initiate a transfer. Phase C only — default implementation refuses.
     */
    initiateTransfer?(input: {
        amount: number;
        currency: string;
        destination: string;
        reference: string;
    }): Promise<{ transferId: string }>;
}

/**
 * Registry. Kenya-first: M-PESA and manual statement parsing ship first;
 * other rails register as adapters land. Nothing may bypass this registry.
 */
const registry = new Map<RailId, PaymentRail>();

export function registerRail(rail: PaymentRail): void {
    registry.set(rail.id, rail);
}

export function getRail(id: RailId): PaymentRail | null {
    return registry.get(id) ?? null;
}

export function listRails(): PaymentRail[] {
    return Array.from(registry.values());
}
