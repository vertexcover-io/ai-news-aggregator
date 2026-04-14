import type { RawItemInsert } from "@newsletter/shared/db";
import { createLogger } from "@newsletter/shared/logger";
import { fetchMarkdown as defaultFetchMarkdown } from "@pipeline/services/markdown-fetch.js";

const logger = createLogger("collector:web-single");

export interface FetchWebPostDeps {
  fetchMarkdownFn?: typeof defaultFetchMarkdown;
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
}

function extractTitle(markdown: string, url: string): string {
  const headingMatch = /^\s*#\s+(.+)$/m.exec(markdown);
  if (headingMatch?.[1]) return headingMatch[1].trim();
  try {
    const u = new URL(url);
    const lastSegment = u.pathname.split("/").filter(Boolean).pop();
    if (lastSegment) {
      return lastSegment.replace(/[-_]/g, " ");
    }
    return u.hostname;
  } catch {
    return url;
  }
}

export async function fetchWebPost(
  url: string,
  deps: FetchWebPostDeps = {},
): Promise<RawItemInsert> {
  const fetchMarkdownFn = deps.fetchMarkdownFn ?? defaultFetchMarkdown;

  logger.info({ event: "web.single.fetch", url }, "web.single.fetch");

  const markdown = await fetchMarkdownFn(url, {
    signal: deps.signal,
    fetchFn: deps.fetchFn,
  });
  const title = extractTitle(markdown, url);
  const now = new Date();

  return {
    sourceType: "blog",
    externalId: url,
    title,
    url,
    sourceUrl: url,
    author: null,
    content: markdown,
    publishedAt: null,
    collectedAt: now,
    engagement: { points: 0, commentCount: 0 },
    metadata: { comments: [] },
    updatedAt: now,
  };
}
