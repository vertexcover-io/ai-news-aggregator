import type { RawItemInsert } from "@newsletter/shared/db";
import type { RankedItem } from "@newsletter/shared";
import { createLogger } from "@newsletter/shared/logger";
import type {
  RawItemsRepo,
  RawItemRow,
} from "@pipeline/repositories/raw-items.js";
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
import {
  generateRecap as defaultGenerateRecap,
  type GenerateRecapOptions,
} from "@pipeline/processors/recap.js";
import { createCostTracker } from "@pipeline/services/cost-tracker.js";
import type { RunArchivesRepo } from "@pipeline/repositories/run-archives.js";

const logger = createLogger("service:add-post-helper");

export type AddPostSourceType = "hn" | "reddit" | "twitter" | "web";

export function detectAddPostSourceType(url: string): AddPostSourceType {
  if (parseTweetIdFromUrl(url) !== null) return "twitter";
  if (parseHnItemIdFromUrl(url) !== null) return "hn";
  if (parseRedditPostUrl(url) !== null) return "reddit";
  return "web";
}

export interface AddPostDeps {
  rawItemsRepo: RawItemsRepo;
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
  generateRecap?: typeof defaultGenerateRecap;
  fetchFn?: typeof fetch;
  recapOptions?: GenerateRecapOptions;
  signal?: AbortSignal;
  archiveRepo?: RunArchivesRepo;
  runId?: string;
}

async function dispatchFetch(
  url: string,
  sourceType: AddPostSourceType,
  deps: AddPostDeps,
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
      return defaultFetchTwitterPost(url, await buildDefaultTwitterDeps(forwarded));
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
        rettiwtCtor:
          Rettiwt as unknown as new (opts: {
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

async function buildDefaultTwitterDeps(
  forwarded: { signal?: AbortSignal; fetchFn?: typeof fetch },
): Promise<FetchTwitterPostDeps> {
  const defaults = await loadTwitterDefaults();
  return {
    signal: forwarded.signal,
    fetchFn: forwarded.fetchFn,
    resolveCookie: defaults.resolveCookie,
    rettiwtFactory: (apiKey: string) => new defaults.rettiwtCtor({ apiKey }),
    refreshCsrf: defaults.refreshCsrf,
  };
}

function toRankedItem(row: RawItemRow, score: number): RankedItem {
  return {
    id: row.id,
    rawItemId: row.id,
    title: row.metadata.recap?.title ?? row.title,
    url: row.url,
    sourceType: row.sourceType,
    author: row.author,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    engagement: row.engagement,
    score,
    rationale: "Added manually during review",
    content: row.content,
    imageUrl: row.imageUrl,
    recap: row.metadata.recap ?? null,
  };
}

export async function hydrateAddedPost(
  url: string,
  sourceType: AddPostSourceType,
  deps: AddPostDeps,
): Promise<RankedItem> {
  logger.info(
    { event: "add-post.hydrate.start", url, sourceType },
    "add-post.hydrate.start",
  );

  const raw = await dispatchFetch(url, sourceType, deps);

  const existingComments = raw.metadata?.comments ?? [];
  const withFlag: RawItemInsert = {
    ...raw,
    metadata: {
      ...(raw.metadata ?? { comments: [] }),
      comments: existingComments,
      addedInReview: true,
    },
  };

  await deps.rawItemsRepo.upsertItems([withFlag]);

  const saved = await deps.rawItemsRepo.findBySourceAndExternalId(
    raw.sourceType,
    raw.externalId,
  );
  if (!saved) {
    throw new Error(
      `added post not found after upsert: ${raw.sourceType}/${raw.externalId}`,
    );
  }

  const recapFn = deps.generateRecap ?? defaultGenerateRecap;
  const tracker =
    deps.archiveRepo && deps.runId ? createCostTracker(deps.runId) : null;
  const recapOptions: GenerateRecapOptions = {
    ...(deps.recapOptions ?? {}),
    ...(tracker ? { tracker } : {}),
  };
  const recap = await recapFn(
    {
      id: saved.id,
      title: saved.title,
      url: saved.url,
      sourceType: saved.sourceType,
      author: saved.author,
      publishedAt: saved.publishedAt,
      content: saved.content,
    },
    recapOptions,
  );

  await deps.rawItemsRepo.updateRecapData([{ id: saved.id, recap }]);

  if (tracker && deps.archiveRepo && deps.runId && tracker.hasAnyCalls()) {
    try {
      const existing = await deps.archiveRepo.getCostBreakdown(deps.runId);
      const merged = tracker.merge(existing);
      await deps.archiveRepo.setCostBreakdown(deps.runId, merged);
    } catch (err) {
      logger.error(
        {
          event: "add-post.cost_write_failed",
          runId: deps.runId,
          error: err instanceof Error ? err.message : String(err),
        },
        "add-post.cost_write_failed",
      );
    }
  }

  const hydrated: RawItemRow = {
    ...saved,
    metadata: { ...saved.metadata, recap },
  };

  logger.info(
    { event: "add-post.hydrate.done", id: saved.id, sourceType },
    "add-post.hydrate.done",
  );

  return toRankedItem(hydrated, 0);
}
