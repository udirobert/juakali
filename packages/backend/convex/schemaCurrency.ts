import { v } from "convex/values";

/**
 * ISO 4217 currency codes JuaKali supports. Single source of truth —
 * schema.ts re-exports this so validators and query shapes stay in sync.
 * Kenya-first: KES is the default; new markets add their code at venture
 * creation and every money-bearing row carries it.
 */
export const currencyCodeValidator = v.union(
    v.literal("KES"),
    v.literal("USD"),
    v.literal("NGN"),
    v.literal("GHS"),
    v.literal("PHP"),
    v.literal("IDR"),
    v.literal("INR"),
    v.literal("BRL"),
    v.literal("ZAR")
);

export type CurrencyCode = "KES" | "USD" | "NGN" | "GHS" | "PHP" | "IDR" | "INR" | "BRL" | "ZAR";

/** Default currency while Kenya is the only live market. */
export const DEFAULT_CURRENCY: CurrencyCode = "KES";
