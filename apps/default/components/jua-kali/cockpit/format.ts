/**
 * Pure formatting helpers for the cockpit surfaces — hoisted out of the big
 * investor-cockpit render file for reuse and (future) unit testing.
 */

export function formatKes(value: number) {
    return `KES ${value.toLocaleString()}`;
}

/** Human relative time — makes the agent's activity feel present, not archival. */
export function relativeTime(ts: number): string {
    const mins = Math.floor((Date.now() - ts) / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return "yesterday";
    return `${days} days ago`;
}

export function daysUntil(ts: number): number {
    return Math.max(0, Math.ceil((ts - Date.now()) / (24 * 60 * 60 * 1000)));
}

export function formatDue(ts: number | null): string {
    if (!ts) return "—";
    return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatDueLabel(ts: number | null): string {
    if (!ts) return "Next digest —";
    return `Next digest · ${formatDue(ts)}`;
}