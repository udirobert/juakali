const CONVEX_SITE_URL = process.env.CONVEX_SITE_URL ?? "http://localhost:3210";

interface ConvexResponse<T> {
    status: number;
    value?: T;
    errorMessage?: string;
}

export async function convexQuery<T>(path: string, args: Record<string, unknown> = {}): Promise<T> {
    const response = await fetch(`${CONVEX_SITE_URL}/api/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, args }),
    });
    if (!response.ok) throw new Error(`Convex query failed: ${response.status}`);
    const result = (await response.json()) as ConvexResponse<T>;
    if (result.errorMessage) throw new Error(result.errorMessage);
    return result.value as T;
}

export async function convexMutation<T>(path: string, args: Record<string, unknown> = {}): Promise<T> {
    const response = await fetch(`${CONVEX_SITE_URL}/api/mutation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, args }),
    });
    if (!response.ok) throw new Error(`Convex mutation failed: ${response.status}`);
    const result = (await response.json()) as ConvexResponse<T>;
    if (result.errorMessage) throw new Error(result.errorMessage);
    return result.value as T;
}

export async function convexAction<T>(path: string, args: Record<string, unknown> = {}): Promise<T> {
    const response = await fetch(`${CONVEX_SITE_URL}/api/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, args }),
    });
    if (!response.ok) throw new Error(`Convex action failed: ${response.status}`);
    const result = (await response.json()) as ConvexResponse<T>;
    if (result.errorMessage) throw new Error(result.errorMessage);
    return result.value as T;
}
