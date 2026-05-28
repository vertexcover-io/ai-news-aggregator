import type { PoolResponse, RankedItem, RankedItemRef } from "@newsletter/shared";
import type { DigestMeta } from "@newsletter/shared/constants";
import { deriveRawItemIdentifier } from "@newsletter/shared/services";
import type { RawItemsRepo } from "@api/repositories/raw-items.js";
import { buildItemPreview } from "./item-preview.js";
import type {
  RunArchiveRow,
  RunArchivesRepo,
  UpdateRankedItemsContext,
} from "@api/repositories/run-archives.js";
import type { ReviewEditsRepo } from "@api/repositories/review-edits.js";
import { diffReview } from "@newsletter/shared/review-edits";
import { detectAddPostSourceType, type AddPostSourceType } from "@newsletter/pipeline/add-post";
export type { AddPostSourceType };

export type GenerateRecapFn = (
  item: RecapInputItem,
  opts?: GenerateRecapOptions,
) => Promise<RecapContent>;

// These types are inlined to avoid a hard import (real fn is dynamically loaded)
interface RecapContent {
  title: string;
  summary: string;
  bullets: string[];
  bottomLine: string;
}

interface RecapInputItem {
  id: number;
  title: string;
  url: string;
  sourceType: string;
  author: string | null;
  publishedAt: Date | null;
  content: string | null;
}

interface GenerateRecapOptions {
  modelId?: string;
}

import { NotFoundError } from "@api/lib/errors.js";
export { NotFoundError };

export class ValidationError extends Error {
  readonly missingIds: number[];
  constructor(message: string, missingIds: number[] = []) {
    super(message);
    this.name = "ValidationError";
    this.missingIds = missingIds;
  }
}

export class ConflictError extends Error {
  constructor(message = "already in the list") {
    super(message);
    this.name = "ConflictError";
  }
}

export type HydrateAddedPostFn = (
  url: string,
  sourceType: AddPostSourceType,
  options?: { signal?: AbortSignal },
) => Promise<RankedItem>;

export interface DigestMetaInputItem {
  rank: number;
  title: string;
  summary: string;
  bottomLine: string;
}

export type GenerateDigestMetaFn = (
  items: DigestMetaInputItem[],
) => Promise<DigestMeta>;

export interface ReviewDeps {
  archiveRepo: RunArchivesRepo;
  rawItemsRepo: RawItemsRepo;
  hydrateAddedPost?: HydrateAddedPostFn;
  reviewEditsRepo?: ReviewEditsRepo;
}

export interface PatchArchiveInput {
  rankedItems: {
    id: number;
    sourceType: string;
    title?: string;
    summary?: string;
    bullets?: string[];
    bottomLine?: string;
    imageUrl?: string | null;
  }[];
  // Optional digest-meta fields. An omitted key (absent from the parsed body)
  // preserves the existing column; a present `null`/string is written verbatim.
  digestHeadline?: string | null;
  digestSummary?: string | null;
  hook?: string | null;
  twitterSummary?: string | null;
  linkedinPostBody?: string | null;
}

export async function patchArchive(
  runId: string,
  input: PatchArchiveInput,
  deps: ReviewDeps,
): Promise<RunArchiveRow> {
  const archive = await deps.archiveRepo.findById(runId);
  if (!archive) throw new NotFoundError(`archive not found: ${runId}`);

  const ids = input.rankedItems.map((i) => i.id);
  const found = await deps.rawItemsRepo.findByIds(ids);
  const foundIds = new Set(found.map((r) => r.id));
  const missing = ids.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    throw new ValidationError(
      `unknown raw_items ids: ${missing.join(", ")}`,
      missing,
    );
  }

  const refs: RankedItemRef[] = input.rankedItems.map((i) => {
    const ref: RankedItemRef = { rawItemId: i.id, score: 0, rationale: "" };
    if (i.title !== undefined) ref.title = i.title;
    if (i.summary !== undefined) ref.summary = i.summary;
    if (i.bullets !== undefined) ref.bullets = i.bullets;
    if (i.bottomLine !== undefined) ref.bottomLine = i.bottomLine;
    if (i.imageUrl !== undefined) ref.imageUrl = i.imageUrl;
    return ref;
  });
  const rawItemsById = new Map(found.map((r) => [r.id, r]));

  // Only include keys actually present in `input` so the repo can distinguish
  // "not provided → preserve" from "set to null/empty" (EDGE-004 / EDGE-009).
  // The zod parse drops absent optional keys, so `"k" in input` is a faithful
  // presence check.
  const digestMeta: NonNullable<UpdateRankedItemsContext["digestMeta"]> = {};
  if ("digestHeadline" in input) digestMeta.digestHeadline = input.digestHeadline;
  if ("digestSummary" in input) digestMeta.digestSummary = input.digestSummary;
  if ("hook" in input) digestMeta.hook = input.hook;
  if ("twitterSummary" in input) digestMeta.twitterSummary = input.twitterSummary;
  if ("linkedinPostBody" in input) digestMeta.linkedinPostBody = input.linkedinPostBody;

  // Effective post-patch headline/summary so searchText reflects the new copy.
  const effectiveHeadline =
    "digestHeadline" in input ? input.digestHeadline ?? null : archive.digestHeadline;
  const effectiveSummary =
    "digestSummary" in input ? input.digestSummary ?? null : archive.digestSummary;

  const updateCtx: NonNullable<UpdateRankedItemsContext> = {
    rawItemsById,
    digestHeadline: effectiveHeadline,
    digestSummary: effectiveSummary,
    digestMeta: Object.keys(digestMeta).length > 0 ? digestMeta : undefined,
  };

  // REQ-003 / REQ-007: compute diff when snapshot is present, skip when NULL.
  // The archive UPDATE + review_edits DELETE/INSERT must be atomic.
  if (deps.reviewEditsRepo && archive.preReviewSnapshot) {
    const edits = diffReview(archive.preReviewSnapshot, {
      rankedItems: input.rankedItems.map((i) => ({
        id: i.id,
        ...(i.title !== undefined ? { title: i.title } : {}),
        ...(i.summary !== undefined ? { summary: i.summary } : {}),
        ...(i.bullets !== undefined ? { bullets: i.bullets } : {}),
        ...(i.bottomLine !== undefined ? { bottomLine: i.bottomLine } : {}),
      })),
      ...("digestHeadline" in input ? { digestHeadline: input.digestHeadline } : {}),
      ...("digestSummary" in input ? { digestSummary: input.digestSummary } : {}),
      ...("hook" in input ? { hook: input.hook } : {}),
      ...("twitterSummary" in input ? { twitterSummary: input.twitterSummary } : {}),
    });
    const editsRepo = deps.reviewEditsRepo;
    return deps.archiveRepo.runTransaction(async (tx) => {
      await editsRepo.replaceForRun(runId, edits, tx);
      return deps.archiveRepo.updateRankedItemsInTx(runId, refs, updateCtx, tx);
    });
  }

  return deps.archiveRepo.updateRankedItems(runId, refs, updateCtx);
}

export interface AddPostInput {
  url: string;
}

const ADD_POST_TIMEOUT_MS = 30_000;

export async function addPostToArchive(
  runId: string,
  input: AddPostInput,
  deps: ReviewDeps,
  options: { timeoutMs?: number } = {},
): Promise<RankedItem> {
  const archive = await deps.archiveRepo.findById(runId);
  if (!archive) throw new NotFoundError(`archive not found: ${runId}`);

  const existingIds = archive.rankedItems.map((r) => r.rawItemId);
  if (existingIds.length > 0) {
    const existingRows = await deps.rawItemsRepo.findByIds(existingIds);
    const dupe = existingRows.find((r) => r.url === input.url);
    if (dupe) throw new ConflictError();
  }

  if (!deps.hydrateAddedPost) {
    throw new Error("hydrateAddedPost dependency not configured");
  }

  const sourceType = detectAddPostSourceType(input.url);
  const ac = new AbortController();
  const timer = setTimeout(() => {
    ac.abort();
  }, options.timeoutMs ?? ADD_POST_TIMEOUT_MS);
  try {
    return await deps.hydrateAddedPost(input.url, sourceType, {
      signal: ac.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export interface RegenerateDigestMetaInput {
  items: { id: number; title: string; summary: string; bottomLine: string }[];
}

export interface RegenerateDigestMetaDeps {
  archiveRepo: RunArchivesRepo;
  rawItemsRepo: RawItemsRepo;
  generateDigestMeta: GenerateDigestMetaFn;
}

export async function regenerateDigestMeta(
  runId: string,
  input: RegenerateDigestMetaInput,
  deps: RegenerateDigestMetaDeps,
): Promise<DigestMeta> {
  const archive = await deps.archiveRepo.findById(runId);
  if (!archive) throw new NotFoundError(`archive not found: ${runId}`);
  if (archive.isDryRun) {
    throw new ConflictError("cannot regenerate digest for a dry-run archive");
  }

  // Validate against raw_items (not archive.rankedItems) so freshly added
  // posts can be regenerated before the operator clicks Save.
  const ids = input.items.map((i) => i.id);
  const existing = await deps.rawItemsRepo.findByIds(ids);
  const found = new Set(existing.map((r) => r.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new ValidationError(
      `unknown raw item ids: ${missing.join(", ")}`,
      missing,
    );
  }

  const items: DigestMetaInputItem[] = input.items.map((i, index) => ({
    rank: index + 1,
    title: i.title,
    summary: i.summary,
    bottomLine: i.bottomLine,
  }));

  return deps.generateDigestMeta(items);
}

export interface GetPoolQuery {
  sort: "engagement" | "recency";
  source?: string;
  q?: string;
  offset: number;
  limit: number;
  selectedSources?: string[];
  shortlistedOnly?: boolean;
}

export async function getPool(
  runId: string,
  query: GetPoolQuery,
  deps: { archiveRepo: RunArchivesRepo },
): Promise<PoolResponse> {
  const archive = await deps.archiveRepo.findById(runId);
  if (!archive) throw new NotFoundError(`Archive ${runId} not found`);
  if (!archive.startedAt || !archive.sourceTypes) {
    return { items: [], total: 0 };
  }
  const rankedIds = archive.rankedItems.map((r) => r.rawItemId);
  return deps.archiveRepo.findPoolItems(runId, {
    rankedIds,
    startedAt: archive.startedAt,
    sourceTypes: archive.sourceTypes,
    sort: query.sort,
    source: query.source as (typeof archive.sourceTypes)[number] | undefined,
    q: query.q,
    offset: query.offset,
    limit: query.limit,
    selectedSources: query.selectedSources,
    shortlistedOnly: query.shortlistedOnly,
    shortlistedIds: query.shortlistedOnly ? (archive.shortlistedItemIds ?? null) : undefined,
  });
}

export interface PromoteDeps {
  archiveRepo: RunArchivesRepo;
  rawItemsRepo: RawItemsRepo;
  generateRecapFn: GenerateRecapFn;
}

export async function promoteItem(
  runId: string,
  input: { rawItemId: number },
  deps: PromoteDeps,
): Promise<RankedItem> {
  const archive = await deps.archiveRepo.findById(runId);
  if (!archive) throw new NotFoundError(`Archive ${runId} not found`);

  const alreadyRanked = archive.rankedItems.some(
    (r) => r.rawItemId === input.rawItemId,
  );
  if (alreadyRanked) throw new ConflictError("Item is already in the ranked list");

  const rows = await deps.rawItemsRepo.findByIds([input.rawItemId]);
  if (rows.length === 0) {
    throw new NotFoundError(`raw item not found: ${input.rawItemId}`);
  }
  const rawItem = rows[0];

  const recapInput: RecapInputItem = {
    id: rawItem.id,
    title: rawItem.title,
    url: rawItem.url,
    sourceType: rawItem.sourceType,
    author: rawItem.author,
    publishedAt: rawItem.publishedAt,
    content: rawItem.content,
  };
  const recap = await deps.generateRecapFn(recapInput);

  return {
    id: rawItem.id,
    rawItemId: rawItem.id,
    title: recap.title || rawItem.title,
    url: rawItem.url,
    sourceType: rawItem.sourceType,
    author: rawItem.author,
    publishedAt: rawItem.publishedAt ? rawItem.publishedAt.toISOString() : null,
    engagement: rawItem.engagement,
    score: 0,
    rationale: "",
    content: rawItem.content,
    imageUrl: rawItem.imageUrl,
    recap,
    enrichedSource: null,
    sourceIdentifier: deriveRawItemIdentifier({
      sourceType: rawItem.sourceType,
      url: rawItem.url,
      sourceUrl: rawItem.sourceUrl,
      metadata: rawItem.metadata,
    }),
    preview: buildItemPreview(rawItem),
  };
}
