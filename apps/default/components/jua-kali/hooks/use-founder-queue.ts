/**
 * Offline check-in queue — the founder's safety net.
 *
 * A founder on a low-end Android over patchy network should never lose a
 * check-in to a failed send. Writes land in durable local storage first
 * (SecureStore on native, localStorage on web), then flush to Convex when
 * connectivity allows. Every state change is honest and visible:
 *
 *   queued    → saved on this device, not yet sent
 *   sending   → flush in progress
 *   sent      → confirmed by the backend (removed from the queue)
 *   failed    → backend rejected it (validation), surfaced for review
 *
 * The queue survives app restarts. Nothing silently disappears: a failed
 * item stays until the founder reviews it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

import { readLocal, writeLocal } from "@/components/jua-kali/session-persist";

const QUEUE_KEY = "juakali_founder_queue_v1";

export type QueuedCheckIn = {
    id: string;
    createdAt: number;
    /** Which mutation to run on flush. */
    kind: "self_checkin" | "venture_update";
    /** Self check-in payload. */
    value?: number;
    /** Shared payload. */
    body?: string;
    tag?: "situation" | "problem" | "opportunity" | "win";
    kpiValue?: number;
    verification?: "self_reported" | "photo_evidence" | "third_party";
    commitmentId?: string | null;
    followUp?: string;
    /** Status: queued | sending | failed. */
    status: "queued" | "sending" | "failed";
    /** Human-readable failure reason (failed only). */
    error?: string;
};

type QueueState = {
    items: QueuedCheckIn[];
};

async function loadQueue(): Promise<QueueState> {
    const raw = await readLocal(QUEUE_KEY);
    if (!raw) return { items: [] };
    try {
        const parsed = JSON.parse(raw) as QueueState;
        if (!Array.isArray(parsed.items)) return { items: [] };
        // Any item caught mid-send when the app died goes back to queued.
        return {
            items: parsed.items.map((item) =>
                item.status === "sending" ? { ...item, status: "queued" as const } : item
            ),
        };
    } catch {
        return { items: [] };
    }
}

async function saveQueue(state: QueueState): Promise<void> {
    await writeLocal(QUEUE_KEY, JSON.stringify(state));
}

function newId(): string {
    return `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * The queue hook. Returns the current items plus enqueue/flush/dismiss
 * controls. Flush runs on mount, on connectivity regain, and on demand.
 */
export function useFounderQueue(flushers: {
    selfCheckIn: (args: {
        value: number;
        note?: string;
        verification?: "self_reported" | "photo_evidence" | "third_party";
    }) => Promise<unknown>;
    ventureUpdate: (args: {
        body: string;
        tag: "situation" | "problem" | "opportunity" | "win";
        kpiValue?: number;
        verification?: "self_reported" | "photo_evidence" | "third_party";
        commitmentId?: string;
    }) => Promise<unknown>;
}) {
    const [items, setItems] = useState<QueuedCheckIn[]>([]);
    const [online, setOnline] = useState(true);
    const flushersRef = useRef(flushers);
    flushersRef.current = flushers;
    const flushingRef = useRef(false);

    // Load persisted queue on mount.
    useEffect(() => {
        void loadQueue().then((state) => setItems(state.items));
    }, []);

    // Connectivity: web uses the browser events; native uses NetInfo.
    useEffect(() => {
        if (Platform.OS === "web" && typeof window !== "undefined") {
            const goOnline = () => setOnline(true);
            const goOffline = () => setOnline(false);
            window.addEventListener("online", goOnline);
            window.addEventListener("offline", goOffline);
            setOnline(navigator.onLine);
            return () => {
                window.removeEventListener("online", goOnline);
                window.removeEventListener("offline", goOffline);
            };
        }
        // Native: NetInfo via dynamic require to avoid a hard dependency here.
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const NetInfoModule = require("@react-native-community/netinfo");
            const NetInfo = NetInfoModule.default ?? NetInfoModule;
            if (typeof NetInfo.addEventListener === "function") {
                const unsubscribeNet = NetInfo.addEventListener((state: { isConnected: boolean | null }) =>
                    setOnline(Boolean(state.isConnected))
                );
                return () => unsubscribeNet?.();
            }
        } catch {
            // NetInfo not installed — assume online; flush retries handle it.
        }
    }, []);

    const patchItem = useCallback(async (id: string, patch: Partial<QueuedCheckIn>) => {
        setItems((current) => {
            const next = current.map((item) => (item.id === id ? { ...item, ...patch } : item));
            void saveQueue({ items: next });
            return next;
        });
    }, []);

    const enqueue = useCallback(
        async (item: Omit<QueuedCheckIn, "id" | "createdAt" | "status">) => {
            const full: QueuedCheckIn = { ...item, id: newId(), createdAt: Date.now(), status: "queued" };
            setItems((current) => {
                const next = [...current, full];
                void saveQueue({ items: next });
                return next;
            });
            return full.id;
        },
        []
    );

    const flush = useCallback(async () => {
        if (flushingRef.current) return;
        flushingRef.current = true;
        try {
            // Snapshot current items via a fresh load (source of truth on disk).
            const state = await loadQueue();
            for (const item of state.items) {
                if (item.status !== "queued") continue;
                await patchItem(item.id, { status: "sending" });
                try {
                    if (item.kind === "self_checkin") {
                        await flushersRef.current.selfCheckIn({
                            value: item.value ?? 0,
                            note: item.body,
                            verification: item.verification,
                        });
                    } else {
                        const body = item.followUp?.trim()
                            ? `${item.body ?? ""}\n\nFollow-up: ${item.followUp.trim()}`
                            : (item.body ?? "");
                        await flushersRef.current.ventureUpdate({
                            body,
                            tag: item.tag ?? "situation",
                            kpiValue: item.kpiValue,
                            verification: item.verification,
                            commitmentId: item.commitmentId ?? undefined,
                        });
                    }
                    // Sent — remove from queue.
                    setItems((current) => {
                        const next = current.filter((row) => row.id !== item.id);
                        void saveQueue({ items: next });
                        return next;
                    });
                } catch (e) {
                    const message = e instanceof Error ? e.message : "Send failed";
                    // Network-shaped failures go back to queued (retry later);
                    // validation failures stay failed for founder review.
                    const networkish = /network|fetch|timeout|unreachable|Failed to fetch/i.test(message);
                    await patchItem(item.id, networkish ? { status: "queued" } : { status: "failed", error: message });
                }
            }
        } finally {
            flushingRef.current = false;
        }
    }, [patchItem]);

    const dismiss = useCallback(async (id: string) => {
        setItems((current) => {
            const next = current.filter((row) => row.id !== id);
            void saveQueue({ items: next });
            return next;
        });
    }, []);

    const retry = useCallback(
        async (id: string) => {
            await patchItem(id, { status: "queued", error: undefined });
            void flush();
        },
        [flush, patchItem]
    );

    // Flush on mount, when connectivity returns, and when the queue gains a
    // queued item while online.
    useEffect(() => {
        if (!online) return;
        const hasQueued = items.some((item) => item.status === "queued");
        if (hasQueued) void flush();
    }, [online, items, flush]);

    return { items, online, enqueue, flush, dismiss, retry };
}
