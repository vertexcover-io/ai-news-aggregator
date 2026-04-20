import { delay } from "@pipeline/services/markdown-fetch.js";

export const MAX_FETCH_RETRIES = 3;

export async function fetchWithRetry<T>(
  fetchFn: typeof fetch,
  url: string,
  parse: (data: unknown) => T,
  retries: number = MAX_FETCH_RETRIES,
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetchFn(url);
      if (!response.ok) {
        const status = response.status;
        if (status >= 400 && status < 500 && status !== 429) {
          throw new Error(`Non-retryable HTTP error: ${status}`);
        }
        throw new Error(`HTTP error: ${status}`);
      }
      const data: unknown = await response.json();
      return parse(data);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (lastError.message.startsWith("Non-retryable")) {
        throw lastError;
      }
      if (attempt < retries - 1) {
        const backoffMs = Math.pow(2, attempt) * 1000;
        await delay(backoffMs);
      }
    }
  }

  throw lastError ?? new Error("Fetch failed after retries");
}
