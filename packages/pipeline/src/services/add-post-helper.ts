import type { RawItemInsert } from "@newsletter/shared/db";
import type { RankedItem } from "@newsletter/shared";
import { createLogger } from "@newsletter/shared/logger";
import type {
  RawItemsRepo,
  RawItemRow,
} from "@pipeline/repositories/raw-items.js";
import {
  fetchHnPost as defaultFetchHnPost,
  type FetchHnPostDeps,
} from "@pipeline/collectors/hn-single.js";
import {
  fetchRedditPost as defaultFetchRedditPost,
  type FetchRedditPostDeps,
} from "@pipeline/collectors/reddit-single.js";
import {
  fetchWebPost as defaultFetchWebPost,
  type FetchWebPostDeps,
} from "@pipeline/collectors/web-single.js";
import {
  generateRecap as defaultGenerateRecap,
  type GenerateRecapOptions,
} from "@pipeline/processors/recap.js";

const logger = createLogger("service:add-post-helper");

export type AddPostSourceType = "hn" | "reddit" | "web";

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
  generateRecap?: typeof defaultGenerateRecap;
  fetchFn?: typeof fetch;
  recapOptions?: GenerateRecapOptions;
  signal?: AbortSignal;
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

function toRankedItem(row: RawItemRow, score: number): RankedItem {
  return {
    id: row.id,
    rawItemId: row.id,
    title: row.title,
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
    deps.recapOptions ?? {},
  );

  await deps.rawItemsRepo.updateRecapData([{ id: saved.id, recap }]);

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
