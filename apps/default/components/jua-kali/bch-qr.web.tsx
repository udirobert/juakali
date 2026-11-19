import { AlphanumericQRCode } from "@wizardconnect/react";

/**
 * Web QR for the wiz:// pairing URI (Alphanumeric mode, per the protocol).
 * Native gets the text fallback in ./bch-qr.tsx — the canvas implementation
 * in @wizardconnect/react is DOM-only.
 */
export function BchQr({ value, size = 220 }: { value: string; size?: number }) {
    return <AlphanumericQRCode value={value} size={size} />;
}
