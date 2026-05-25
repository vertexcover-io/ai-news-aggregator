import type { RawItemInsert } from "@newsletter/shared/db";
import type { RankedItem } from "@newsletter/shared";
import { pickCandidateContent } from "@pipeline/services/candidate-loader.js";
import { createLogger } from "@newsletter/shared/logger";
import type {
  RawItemsRepo,
  RawItemRow,
} from "@pipeline/repositories/raw-items.js";
import type { FetchHnPostDeps } from "@pipeline/collectors/hn.js";
import type { FetchRedditPostDeps } from "@pipeline/collectors/reddit.js";
import type { FetchWebPostDeps } from "@pipeline/collectors/web.js";
import type { FetchTwitterPostDeps } from "@pipeline/collectors/twitter/index.js";
import {
  generateRecap as defaultGenerateRecap,
  type GenerateRecapOptions,
} from "@pipeline/processors/recap.js";
import { createCostTracker } from "@pipeline/services/cost-tracker.js";
import type { RunArchivesRepo } from "@pipeline/repositories/run-archives.js";
import {
  detectAddPostSourceType,
  dispatchFetch,
  type AddPostSourceType,
} from "@pipeline/services/add-post/dispatch.js";

const logger = createLogger("service:add-post-helper");

export { detectAddPostSourceType };
export type { AddPostSourceType };

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
    enrichedSource: null,
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

  const raw = await dispatchFetch(url, sourceType, {
    fetchHnPost: deps.fetchHnPost,
    fetchRedditPost: deps.fetchRedditPost,
    fetchWebPost: deps.fetchWebPost,
    fetchTwitterPost: deps.fetchTwitterPost,
    fetchFn: deps.fetchFn,
    signal: deps.signal,
  });

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
      content: pickCandidateContent(saved.content, saved.metadata),
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
