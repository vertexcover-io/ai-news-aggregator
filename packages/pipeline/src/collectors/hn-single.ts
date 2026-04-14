import type { RawItemInsert } from "@newsletter/shared/db";
import { createLogger } from "@newsletter/shared/logger";

const logger = createLogger("collector:hn-single");

const HN_ITEM_API = "https://hacker-news.firebaseio.com/v0/item";

export class UrlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlParseError";
  }
}

export interface FetchHnPostDeps {
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
}

interface HnFirebaseItem {
  id: number;
  type: string;
  by?: string;
  title?: string | null;
  url?: string | null;
  score?: number;
  descendants?: number;
  time?: number;
  text?: string | null;
}

function isHnFirebaseItem(value: unknown): value is HnFirebaseItem {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "type" in value &&
    typeof (value as { type: unknown }).type === "string"
  );
}

export function parseHnItemIdFromUrl(url: string): string | null {
  try {
    const u = new URL(url);

    if (u.hostname === "news.ycombinator.com" && u.pathname === "/item") {
      const id = u.searchParams.get("id");
      if (id && /^\d+$/.test(id)) return id;
      return null;
    }

    if (u.hostname === "hn.algolia.com") {
      const hash = u.hash;
      const storyMatch = /\/story\/[^/]+\/\d+\/(\d+)/.exec(hash);
      if (storyMatch?.[1]) return storyMatch[1];
      return null;
    }

    return null;
  } catch {
    return null;
  }
}

export async function fetchHnPost(
  url: string,
  deps: FetchHnPostDeps = {},
): Promise<RawItemInsert> {
  const id = parseHnItemIdFromUrl(url);
  if (!id) {
    throw new UrlParseError(`not a recognized HN item URL: ${url}`);
  }

  const fetchFn = deps.fetchFn ?? fetch;
  const apiUrl = `${HN_ITEM_API}/${id}.json`;

  logger.info({ event: "hn.single.fetch", id, url }, "hn.single.fetch");

  const response = await fetchFn(apiUrl, { signal: deps.signal });
  if (!response.ok) {
    throw new Error(`HN API HTTP ${response.status} for item ${id}`);
  }
  const body: unknown = await response.json();
  if (body === null) {
    throw new Error(`HN item ${id} not found or deleted`);
  }
  if (!isHnFirebaseItem(body)) {
    throw new Error(`HN API returned unexpected shape for item ${id}`);
  }
  if (body.type === "comment") {
    throw new UrlParseError(
      `HN item ${id} is a comment, not a story — cannot add as post`,
    );
  }
  if (!body.title) {
    throw new Error(`HN item ${id} has no title`);
  }

  const now = new Date();
  const publishedAt =
    typeof body.time === "number" ? new Date(body.time * 1000) : null;

  return {
    sourceType: "hn",
    externalId: id,
    title: body.title,
    url: body.url ?? `https://news.ycombinator.com/item?id=${id}`,
    sourceUrl: `https://news.ycombinator.com/item?id=${id}`,
    author: body.by ?? null,
    content: body.text ?? null,
    publishedAt,
    collectedAt: now,
    engagement: {
      points: body.score ?? 0,
      commentCount: body.descendants ?? 0,
    },
    metadata: { comments: [] },
    updatedAt: now,
  };
}
