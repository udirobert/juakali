import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

import type { TeachingPolicy } from "@/lib/product-mode";
import { SOFT_RETURN_MS } from "@/lib/product-mode";

/** ~12h — native “session” proxy when sessionStorage isn’t available. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export const KEYS = {
    onboarded: "juakali_investor_onboarded_v3",
    /** Set when user dismisses welcome-back / finishes orientation this session. */
    sessionOrient: "juakali_session_orient_v1",
    /** Coach dismissed — session key (loud) or durable key (quiet / soft-return). */
    coachSession: "juakali_coach_session_v1",
    coachDurable: "juakali_coach_durable_v1",
    /** Last time user dismissed orientation (soft-return). */
    lastOrientedAt: "juakali_last_oriented_at_v1",
} as const;

export function hasFreshParam(): boolean {
    if (Platform.OS !== "web" || typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("fresh") === "1";
}

export function stripFreshParam(): void {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("fresh")) return;
    url.searchParams.delete("fresh");
    window.history.replaceState({}, "", url.toString());
}

async function readLocal(key: string): Promise<string | null> {
    try {
        if (Platform.OS === "web" && typeof localStorage !== "undefined") {
            return localStorage.getItem(key);
        }
        return await SecureStore.getItemAsync(key);
    } catch {
        return null;
    }
}

async function writeLocal(key: string, value: string): Promise<void> {
    try {
        if (Platform.OS === "web" && typeof localStorage !== "undefined") {
            localStorage.setItem(key, value);
            return;
        }
        await SecureStore.setItemAsync(key, value);
    } catch {
        // ignore
    }
}

async function removeLocal(key: string): Promise<void> {
    try {
        if (Platform.OS === "web" && typeof localStorage !== "undefined") {
            localStorage.removeItem(key);
            return;
        }
        await SecureStore.deleteItemAsync(key);
    } catch {
        // ignore
    }
}

function readSessionRaw(key: string): string | null {
    try {
        if (Platform.OS === "web" && typeof sessionStorage !== "undefined") {
            return sessionStorage.getItem(key);
        }
    } catch {
        // ignore
    }
    return null;
}

function writeSessionRaw(key: string, value: string): void {
    try {
        if (Platform.OS === "web" && typeof sessionStorage !== "undefined") {
            sessionStorage.setItem(key, value);
        }
    } catch {
        // ignore
    }
}

function removeSessionRaw(key: string): void {
    try {
        if (Platform.OS === "web" && typeof sessionStorage !== "undefined") {
            sessionStorage.removeItem(key);
        }
    } catch {
        // ignore
    }
}

/** Durable “has completed landing at least once”. */
export async function readOnboarded(): Promise<boolean> {
    return (await readLocal(KEYS.onboarded)) === "1";
}

export async function writeOnboarded(): Promise<void> {
    await writeLocal(KEYS.onboarded, "1");
}

/**
 * True if orientation was completed in this browser session (web)
 * or within SESSION_TTL_MS (native).
 */
export async function readSessionOriented(): Promise<boolean> {
    if (Platform.OS === "web") {
        return readSessionRaw(KEYS.sessionOrient) === "1";
    }
    const raw = await readLocal(KEYS.sessionOrient);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < SESSION_TTL_MS;
}

export async function writeSessionOriented(): Promise<void> {
    if (Platform.OS === "web") {
        writeSessionRaw(KEYS.sessionOrient, "1");
        return;
    }
    await writeLocal(KEYS.sessionOrient, String(Date.now()));
}

export async function readLastOrientedAt(): Promise<number | null> {
    const raw = await readLocal(KEYS.lastOrientedAt);
    if (!raw) return null;
    const ts = Number(raw);
    return Number.isFinite(ts) ? ts : null;
}

export async function writeLastOrientedAt(ts = Date.now()): Promise<void> {
    await writeLocal(KEYS.lastOrientedAt, String(ts));
}

/**
 * Whether to show welcome-back for the active teaching policy.
 * - loud: every new session until dismissed
 * - soft-return: after SOFT_RETURN_MS since last orient (or never oriented)
 * - quiet: never auto
 */
export async function shouldShowWelcomeBack(teaching: TeachingPolicy): Promise<boolean> {
    if (teaching === "quiet") return false;
    if (teaching === "loud") {
        return !(await readSessionOriented());
    }
    // soft-return
    const last = await readLastOrientedAt();
    if (last === null) return true;
    return Date.now() - last >= SOFT_RETURN_MS;
}

export async function markOriented(teaching: TeachingPolicy): Promise<void> {
    await writeSessionOriented();
    await writeLastOrientedAt();
    if (teaching === "loud") {
        // session coach handled separately
        return;
    }
}

export async function readCoachDismissed(sessionScoped: boolean): Promise<boolean> {
    if (sessionScoped) {
        if (Platform.OS === "web") {
            return readSessionRaw(KEYS.coachSession) === "1";
        }
        const raw = await readLocal(KEYS.coachSession);
        if (!raw) return false;
        const ts = Number(raw);
        if (!Number.isFinite(ts)) return false;
        return Date.now() - ts < SESSION_TTL_MS;
    }
    return (await readLocal(KEYS.coachDurable)) === "1";
}

export async function writeCoachDismissed(sessionScoped: boolean): Promise<void> {
    if (sessionScoped) {
        if (Platform.OS === "web") {
            writeSessionRaw(KEYS.coachSession, "1");
            return;
        }
        await writeLocal(KEYS.coachSession, String(Date.now()));
        return;
    }
    await writeLocal(KEYS.coachDurable, "1");
}

/** Clear demo gates — used by `?fresh=1`. */
export async function clearDemoGates(): Promise<void> {
    await removeLocal(KEYS.onboarded);
    await removeLocal(KEYS.sessionOrient);
    await removeLocal(KEYS.coachSession);
    await removeLocal(KEYS.coachDurable);
    await removeLocal(KEYS.lastOrientedAt);
    removeSessionRaw(KEYS.sessionOrient);
    removeSessionRaw(KEYS.coachSession);
}
