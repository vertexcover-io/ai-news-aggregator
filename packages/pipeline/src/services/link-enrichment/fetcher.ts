import type { EnrichedLinkContent } from "@newsletter/shared";
import { fetchAdaptive } from "@pipeline/services/web-fetch/fetch-adaptive.js";
import { getContentType } from "@pipeline/services/link-enrichment/url-classifier.js";
import type { EnrichmentContext } from "@pipeline/services/link-enrichment/types.js";

const MAX_MARKDOWN_CHARS = 100_000;
const FETCH_TIMEOUT_MS = 15_000;

function composeSignal(ctxSignal: AbortSignal | undefined, timeoutSignal: AbortSignal): AbortSignal {
  if (!ctxSignal) return timeoutSignal;
  return AbortSignal.any([ctxSignal, timeoutSignal]);
}

function extractFailureReason(err: unknown, ctxSignal: AbortSignal | undefined): string {
  if (ctxSignal?.aborted) return "cancelled";
  const msg = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "";
  if (name === "TimeoutError" || /abort|timeout/i.test(msg)) return "timeout";
  const httpMatch = /HTTP\s+(\d{3})/i.exec(msg);
  if (httpMatch) return `http_${httpMatch[1]}`;
  return msg.slice(0, 120);
}

export async function enrichOne(
  originalUrl: string,
  canonical: string,
  ctx: EnrichmentContext,
): Promise<EnrichedLinkContent> {
  const start = Date.now();
  const timeoutSignal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const signal = composeSignal(ctx.signal, timeoutSignal);
  const domain = (() => {
    try {
      return new URL(canonical).host;
    } catch {
      return undefined;
    }
  })();
  const contentType = getContentType(canonical);

  try {
    const result = await fetchAdaptive(originalUrl, "article", { signal });
    const durationMs = Date.now() - start;
    ctx.counters.totalFetchMs += durationMs;

    const truncatedMarkdown =
      result.markdown.length > MAX_MARKDOWN_CHARS
        ? result.markdown.slice(0, MAX_MARKDOWN_CHARS)
        : result.markdown;

    const enriched: EnrichedLinkContent = {
      url: canonical,
      fetchedAt: new Date().toISOString(),
      status: "ok",
      title: result.title ?? undefined,
      byline: result.byline ?? undefined,
      imageUrl: result.imageUrl ?? undefined,
      domain,
      contentType,
      markdown: truncatedMarkdown,
      textLength: result.textLength,
    };
    ctx.logger.info(
      {
        event: "enrichment.fetched",
        url: canonical,
        domain,
        status: "ok",
        durationMs,
        contentType,
        textLength: result.textLength,
      },
      "enrichment.fetched",
    );
    return enriched;
  } catch (err) {
    const durationMs = Date.now() - start;
    ctx.counters.totalFetchMs += durationMs;
    const failureReason = extractFailureReason(err, ctx.signal);
    const enriched: EnrichedLinkContent = {
      url: canonical,
      fetchedAt: new Date().toISOString(),
      status: "failed",
      failureReason,
      domain,
      contentType,
    };
    ctx.logger.warn(
      {
        event: "enrichment.fetched",
        url: canonical,
        domain,
        status: "failed",
        durationMs,
        contentType,
        failureReason,
      },
      "enrichment.fetched",
    );
    return enriched;
  }
}
