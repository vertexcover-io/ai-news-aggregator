import type { RankedItem, RankedItemRef } from "@newsletter/shared";
import type { RawItemsRepo } from "@api/repositories/raw-items.js";
import type {
  RunArchiveRow,
  RunArchivesRepo,
} from "@api/repositories/run-archives.js";
import { detectAddPostSourceType, type AddPostSourceType } from "@newsletter/pipeline/add-post";
export type { AddPostSourceType };

export class NotFoundError extends Error {
  constructor(message = "not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

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

export interface ReviewDeps {
  archiveRepo: RunArchivesRepo;
  rawItemsRepo: RawItemsRepo;
  hydrateAddedPost?: HydrateAddedPostFn;
}

export interface PatchArchiveInput {
  rankedItems: { id: number; sourceType: string }[];
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

  const refs: RankedItemRef[] = input.rankedItems.map((i) => ({
    rawItemId: i.id,
    score: 0,
    rationale: "",
  }));
  return deps.archiveRepo.updateRankedItems(runId, refs);
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
