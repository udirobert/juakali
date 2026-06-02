const BACKEND_URL = process.env.JUAKALI_BACKEND_URL ?? "http://localhost:3210";

interface BackendResponse<T> {
    status: number;
    value?: T;
    errorMessage?: string;
}

export async function callBackend<T>(
    path: string,
    args: Record<string, unknown>,
    type: "query" | "mutation" | "action" = "query"
): Promise<T> {
    const url = `${BACKEND_URL}/api/${type}`;
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, args }),
    });

    if (!response.ok) {
        throw new Error(`Backend request failed: ${response.status} ${response.statusText}`);
    }

    const result = (await response.json()) as BackendResponse<T>;
    if (result.errorMessage) {
        throw new Error(result.errorMessage);
    }

    return result.value as T;
}
