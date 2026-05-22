import type { RawItemInsert } from "@newsletter/shared/db";
import {
  fetchHnPost as defaultFetchHnPost,
  parseHnItemIdFromUrl,
  type FetchHnPostDeps,
} from "@pipeline/collectors/hn.js";
import {
  fetchRedditPost as defaultFetchRedditPost,
  parseRedditPostUrl,
  type FetchRedditPostDeps,
} from "@pipeline/collectors/reddit.js";
import {
  fetchWebPost as defaultFetchWebPost,
  type FetchWebPostDeps,
} from "@pipeline/collectors/web.js";

export type AddPostSourceType = "hn" | "reddit" | "web";

export function detectAddPostSourceType(url: string): AddPostSourceType {
  if (parseHnItemIdFromUrl(url) !== null) return "hn";
  if (parseRedditPostUrl(url) !== null) return "reddit";
  return "web";
}

export interface DispatchFetchDeps {
  fetchHnPost?: (url: string, deps?: FetchHnPostDeps) => Promise<RawItemInsert>;
  fetchRedditPost?: (
    url: string,
    deps?: FetchRedditPostDeps,
  ) => Promise<RawItemInsert>;
  fetchWebPost?: (
    url: string,
    deps?: FetchWebPostDeps,
  ) => Promise<RawItemInsert>;
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
}

export async function dispatchFetch(
  url: string,
  sourceType: AddPostSourceType,
  deps: DispatchFetchDeps = {},
): Promise<RawItemInsert> {
  const forwarded = { signal: deps.signal, fetchFn: deps.fetchFn };
  switch (sourceType) {
    case "hn": {
      const fn = deps.fetchHnPost ?? defaultFetchHnPost;
      return fn(url, forwarded);
    }
    case "reddit": {
      const fn = deps.fetchRedditPost ?? defaultFetchRedditPost;
      return fn(url, forwarded);
    }
    case "web": {
      const fn = deps.fetchWebPost ?? defaultFetchWebPost;
      return fn(url, forwarded);
    }
    default: {
      const _exhaustive: never = sourceType;
      throw new Error(`unsupported sourceType: ${String(_exhaustive)}`);
    }
  }
}
