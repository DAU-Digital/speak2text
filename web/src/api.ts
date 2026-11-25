import { NetworkError } from "@soniox/client";

export class ApiError extends Error {
  constructor(public status: number, message?: string) {
    super(message ?? `HTTP ${status}`);
    this.name = "ApiError";
  }
}

async function post<T>(url: string, init: { body?: unknown; token?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.token) headers["Authorization"] = `Bearer ${init.token}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (err) {
    throw new ApiError(0, err instanceof Error ? err.message : "network error");
  }
  if (!res.ok) throw new ApiError(res.status);
  return (await res.json()) as T;
}

export function login(passcode: string): Promise<{ token: string; expiresAt: string }> {
  return post("/api/login", { body: { passcode } });
}

export async function fetchSttKey(token: string): Promise<string> {
  const { apiKey } = await post<{ apiKey: string }>("/api/stt-key", { token });
  return apiKey;
}

/**
 * Errors from fetching a temporary key inside the SDK's `config()`: the SDK only retries
 * NetworkError/ConnectionError, so network drops, 429 and 5xx are wrapped to get its backoff.
 * 401 stays an ApiError so the app can send the user back to the passcode screen.
 */
export function retriableForSdk(err: unknown): unknown {
  if (err instanceof ApiError && (err.status === 0 || err.status === 429 || err.status >= 500)) {
    return new NetworkError(`temporary key: ${err.message}`, err.status || undefined, err);
  }
  return err;
}
