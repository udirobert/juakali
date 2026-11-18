/**
 * Rail registry initialization. Import this module (once) wherever rails are
 * consumed. Kenya-first: M-PESA + the universal manual-statement fallback
 * ship now; other markets register adapters here as they land.
 */
import { registerRail, getRail, listRails } from "./types";
import { mpesaRail } from "./mpesa";
import { manualStatementRail } from "./manualStatement";

let initialized = false;

export function ensureRails(): void {
    if (initialized) return;
    registerRail(mpesaRail);
    registerRail(manualStatementRail);
    initialized = true;
}

export { getRail, listRails };
