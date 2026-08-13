import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

/**
 * RevenueCat (Shipaton 2026 monetization) — native only.
 *
 * The `react-native-purchases` NPM package ships **no Expo config plugin** (only
 * native autolinking dirs), so we configure it at runtime. All RC code is lazy
 * required and gated to iOS/Android so the **web** export (Netlify) is untouched.
 */

const isNative = Platform.OS === "ios" || Platform.OS === "android";

export const REVENUECAT_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_KEY ?? "";

type RCModule = typeof import("react-native-purchases");

let purchasesModule: RCModule | null = null;

async function loadPurchases(): Promise<RCModule | null> {
    if (purchasesModule) return purchasesModule;
    if (!isNative) return null;
    try {
        // Dynamic import keeps the native module out of the web bundle and is only
        // evaluated when called on iOS/Android.
        purchasesModule = (await import("react-native-purchases")) as RCModule;
        return purchasesModule;
    } catch {
        return null;
    }
}

/**
 * The SDK is delivered as the module's **default export** (`import Purchases from
 * "react-native-purchases"`). Resolve it defensively (default, then named fallback).
 */
function purchasesApi(RC: RCModule): NonNullable<RCModule["default"]> {
    const def = (RC as { default?: RCModule["default"] }).default;
    if (def) return def;
    return (RC as unknown as { Purchases: RCModule["default"] }).Purchases;
}

/** Configure the RC SDK (idempotent). Returns true when configured on native. */
export async function configurePurchases(appUserID?: string | null): Promise<boolean> {
    if (!isNative || !REVENUECAT_API_KEY) return false;
    const RC = await loadPurchases();
    if (!RC) return false;
    await purchasesApi(RC).configure({
        apiKey: REVENUECAT_API_KEY,
        appUserID: appUserID || undefined,
    });
    return true;
}

/** Link the store customer id to a Convex investor id (keeps the webhook mappable). */
export async function logInToInvestor(investorId: string | null | undefined): Promise<void> {
    if (!isNative || !investorId) return;
    const RC = await loadPurchases();
    if (!RC) return;
    try {
        await purchasesApi(RC).logIn(investorId);
    } catch {
        // Non-fatal: RC still records purchase; webhook falls back to app_user_id.
    }
}

export interface OfferingLike {
    identifier: string;
    monthly?: { product: { identifier?: string; priceString?: string } } | null;
    annual?: { product: { identifier?: string; priceString?: string } } | null;
}

/** Fetch the "Monthly"/default offering for the paywall (native only). */
export async function getDefaultOfferings(): Promise<OfferingLike | null> {
    if (!isNative) return null;
    const RC = await loadPurchases();
    if (!RC) return null;
    const offerings = await purchasesApi(RC).getOfferings();
    const current = offerings.current;
    if (!current) return null;
    const monthly = current.monthly ?? null;
    const annual = current.annual ?? null;
    return {
        identifier: current.identifier,
        monthly: monthly
            ? { product: { identifier: monthly.product.identifier, priceString: monthly.product.priceString } }
            : null,
        annual: annual
            ? { product: { identifier: annual.product.identifier, priceString: annual.product.priceString } }
            : null,
    };
}

export type PurchaseResult = { purchased: boolean; message?: string };

/** Purchase the default monthly package (native only). */
export async function purchaseMonthly(): Promise<PurchaseResult> {
    if (!isNative) return { purchased: false, message: "Available on mobile." };
    const RC = await loadPurchases();
    if (!RC) return { purchased: false, message: "Store not configured." };
    try {
        const offerings = await purchasesApi(RC).getOfferings();
        const pkg = offerings.current?.monthly ?? offerings.current?.annual;
        if (!pkg) return { purchased: false, message: "No package available." };
        await purchasesApi(RC).purchasePackage(pkg);
        return { purchased: true };
    } catch (e) {
        const err = e as { userCancelled?: boolean; message?: string };
        if (err?.userCancelled) return { purchased: false, message: "Cancelled." };
        return { purchased: false, message: err?.message ?? "Purchase failed." };
    }
}

/** Re-sync active entitlements with the app store (native only). */
export async function restorePurchases(): Promise<PurchaseResult> {
    if (!isNative) return { purchased: false, message: "Available on mobile." };
    const RC = await loadPurchases();
    if (!RC) return { purchased: false, message: "Store not configured." };
    const info = await purchasesApi(RC).restorePurchases();
    const active = Object.keys(info.entitlements.active);
    return active.length > 0
        ? { purchased: true }
        : { purchased: false, message: "Nothing to restore." };
}

/** Redeem a store code / offer (native only). */
export async function presentRedemption(): Promise<void> {
    if (!isNative) return;
    const RC = await loadPurchases();
    if (!RC) return;
    try {
        await purchasesApi(RC).presentCodeRedemptionSheet();
    } catch {
        // iOS-only; ignore on Android.
    }
}

export type EntitlementState = {
    entitlements: string[];
    has: (entitlement: string) => boolean;
    isLoading: boolean;
    productId: string | null;
    status: "active" | "expired" | null;
};

/** Reactive entitlements, sourced from Convex (`/webhooks/revenuecat` keeps it fresh). */
export function useEntitlements(): EntitlementState {
    const data = useQuery(api.subscriptions.getMyEntitlements);
    const [first, setFirst] = useState(true);
    useEffect(() => {
        if (first && data !== undefined) {
            // On first sight of a signed-in user, configure RC with their investor id.
            void configurePurchases();
            setFirst(false);
        }
    }, [data, first]);
    const entitlements = data?.entitlements ?? [];
    return {
        entitlements,
        has: (e: string) => entitlements.includes(e),
        isLoading: data === undefined,
        productId: data?.productId ?? null,
        status: data?.status ?? null,
    };
}