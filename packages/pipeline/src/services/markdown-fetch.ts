const JINA_BASE_URL = "https://r.jina.ai/";
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

export interface FetchMarkdownOptions {
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
}

export async function fetchMarkdown(
  url: string,
  options: FetchMarkdownOptions = {},
): Promise<string> {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const signal = options.signal;
  const jinaUrl = `${JINA_BASE_URL}${url}`;
  const headers: Record<string, string> = { Accept: "text/plain" };
  const apiKey = process.env.JINA_API_KEY;
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (signal?.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new Error("fetchMarkdown aborted");
    }
    try {
      const response = await fetchFn(jinaUrl, { headers, signal });
      if (!response.ok) {
        const status = response.status;
        if (status >= 400 && status < 500 && status !== 429) {
          throw new Error(`Non-retryable HTTP ${status} for ${url}`);
        }
        throw new Error(`HTTP ${status} for ${url}`);
      }
      const raw = await response.text();
      return raw.trim();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (signal?.aborted) throw lastError;
      if (lastError.message.startsWith("Non-retryable")) throw lastError;
      if (attempt < MAX_RETRIES - 1) {
        await delay(Math.pow(2, attempt) * RETRY_BASE_DELAY_MS);
      }
    }
  }

  throw lastError ?? new Error(`fetchMarkdown failed after ${MAX_RETRIES} retries`);
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(
      signal.reason instanceof Error ? signal.reason : new Error("aborted"),
    );
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new Error("aborted"),
      );
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
