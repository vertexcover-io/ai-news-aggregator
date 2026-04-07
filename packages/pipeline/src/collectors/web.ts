import { createLogger } from "@newsletter/shared/logger";

const logger = createLogger("collector:web");

const JINA_BASE_URL = "https://r.jina.ai/";
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;
const MAX_ERROR_LENGTH = 200;

// Referenced by Phase 5 (failure logging + truncation); kept here to establish module constants.
void logger;
void MAX_ERROR_LENGTH;

export async function fetchMarkdown(
  url: string,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<string> {
  const jinaUrl = `${JINA_BASE_URL}${url}`;
  const headers: Record<string, string> = { Accept: "text/plain" };
  const apiKey = process.env.JINA_API_KEY;
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetchFn(jinaUrl, { headers });
      if (!response.ok) {
        const status = response.status;
        if (status >= 400 && status < 500 && status !== 429) {
          throw new Error(`Non-retryable HTTP ${status} for ${url}`);
        }
        throw new Error(`HTTP ${status} for ${url}`);
      }
      const raw = await response.text();
      return stripJinaEnvelope(raw);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (lastError.message.startsWith("Non-retryable")) throw lastError;
      if (attempt < MAX_RETRIES - 1) {
        await delay(Math.pow(2, attempt) * RETRY_BASE_DELAY_MS);
      }
    }
  }

  throw lastError ?? new Error(`fetchMarkdown failed after ${MAX_RETRIES} retries`);
}

const ENVELOPE_BODY_RE = /\nMarkdown Content:\n([\s\S]*)$/;

function stripJinaEnvelope(raw: string): string {
  const bodyMatch = ENVELOPE_BODY_RE.exec(raw);
  return (bodyMatch ? bodyMatch[1] : raw).trim();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
