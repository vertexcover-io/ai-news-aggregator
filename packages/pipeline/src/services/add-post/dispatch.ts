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
import {
  fetchTwitterPost as defaultFetchTwitterPost,
  parseTweetIdFromUrl,
  type FetchTwitterPostDeps,
  type RettiwtTweetFacade,
} from "@pipeline/collectors/twitter/index.js";

export type AddPostSourceType = "hn" | "reddit" | "twitter" | "web";

export function detectAddPostSourceType(url: string): AddPostSourceType {
  if (parseTweetIdFromUrl(url) !== null) return "twitter";
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
  fetchTwitterPost?: (
    url: string,
    deps?: FetchTwitterPostDeps,
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
    case "twitter": {
      if (deps.fetchTwitterPost) {
        return deps.fetchTwitterPost(url, forwarded);
      }
      return defaultFetchTwitterPost(
        url,
        await buildDefaultTwitterDeps(forwarded),
      );
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

// Default twitter wiring — kept as dynamic imports so the collector itself
// remains free of repo/SDK imports. The freshness contract (admin saves take
// effect on the next call) requires per-invocation cookie resolution; the
// resolver is invoked inside each fetchTwitterPost call, not memoised. The
// SocialCredentialsRepo + Rettiwt constructor ARE memoised — they don't carry
// per-call state.

let cachedTwitterDefaults: Promise<{
  rettiwtCtor: new (opts: { apiKey: string }) => RettiwtTweetFacade;
  resolveCookie: () => Promise<TwitterCookieDefault | null>;
  refreshCsrf: (apiKey: string, source: "db" | "env") => Promise<string | null>;
}> | null = null;

interface TwitterCookieDefault {
  apiKey: string;
  source: "db" | "env";
}

async function loadTwitterDefaults(): Promise<{
  rettiwtCtor: new (opts: { apiKey: string }) => RettiwtTweetFacade;
  resolveCookie: () => Promise<TwitterCookieDefault | null>;
  refreshCsrf: (apiKey: string, source: "db" | "env") => Promise<string | null>;
}> {
  cachedTwitterDefaults ??= (async () => {
    const [
      { resolveTwitterCollectorCookie },
      { refreshRettiwtCsrfToken },
      { createSocialCredentialsRepo },
      { getDb },
      { getCredentialCipher },
      { Rettiwt },
    ] = await Promise.all([
      import("@pipeline/services/credential-resolver.js"),
      import("@pipeline/collectors/twitter/clients/rettiwt-auth.js"),
      import("@pipeline/repositories/social-credentials.js"),
      import("@newsletter/shared/db"),
      import("@newsletter/shared/services/credential-cipher"),
      import("rettiwt-api"),
    ]);

    const repo = createSocialCredentialsRepo(getDb(), getCredentialCipher());

    return {
      rettiwtCtor: Rettiwt as unknown as new (opts: {
        apiKey: string;
      }) => RettiwtTweetFacade,
      resolveCookie: () =>
        resolveTwitterCollectorCookie({ repo, env: process.env }),
      refreshCsrf: async (
        apiKey: string,
        source: "db" | "env",
      ): Promise<string | null> => {
        const holder = { apiKey };
        const ok = await refreshRettiwtCsrfToken({
          rettiwt: holder,
          repo,
          credentialSource: source,
        });
        return ok && holder.apiKey ? holder.apiKey : null;
      },
    };
  })();
  return cachedTwitterDefaults;
}

async function buildDefaultTwitterDeps(forwarded: {
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
}): Promise<FetchTwitterPostDeps> {
  const defaults = await loadTwitterDefaults();
  return {
    signal: forwarded.signal,
    fetchFn: forwarded.fetchFn,
    resolveCookie: defaults.resolveCookie,
    rettiwtFactory: (apiKey: string) => new defaults.rettiwtCtor({ apiKey }),
    refreshCsrf: defaults.refreshCsrf,
  };
}
