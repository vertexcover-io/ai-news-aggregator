export const MAX_RETRIES = 3;
export const RATE_LIMIT_MS = 500;
const BASE_BACKOFF_MS = 1000;

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithRetry(
  fetchFn: typeof fetch,
  url: string,
  options: { headers?: Record<string, string>; retries?: number } = {},
): Promise<unknown> {
  const { headers = {}, retries = MAX_RETRIES } = options;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetchFn(url, { headers });
      if (!response.ok) {
        const status = response.status;
        if (status >= 400 && status < 500 && status !== 429) {
          throw new Error(`Non-retryable HTTP error: ${status}`);
        }
        throw new Error(`HTTP error: ${status}`);
      }
      return await response.json();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (lastError.message.startsWith("Non-retryable")) {
        throw lastError;
      }
      if (attempt < retries - 1) {
        const backoffMs = Math.pow(2, attempt) * BASE_BACKOFF_MS;
        await delay(backoffMs);
      }
    }
  }

  throw lastError ?? new Error("Fetch failed after retries");
}
