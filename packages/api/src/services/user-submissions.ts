import { createHash } from "node:crypto";
import type { RawItemsRepo } from "@api/repositories/raw-items.js";
import type { RankedItem, RawItemMetadata } from "@newsletter/shared";

export type EnrichUrlFn = (url: string) => Promise<{ title?: string; author?: string; content?: string }>;

export interface CreateSubmissionDeps {
  rawItemsRepo: RawItemsRepo;
  enrichUrl: EnrichUrlFn;
}

export interface SubmissionResult {
  id: number;
  url: string;
  title: string;
  sourceType: "manual";
  alreadyExisted: boolean;
}

export function hashUrl(canonical: string): string {
  return createHash("sha256").update(canonical).digest("hex");
}

export async function createUserSubmission(
  input: { url: string; title?: string },
  deps: CreateSubmissionDeps,
): Promise<SubmissionResult> {
  const { canonicalizeUrl } = await import("@newsletter/pipeline/add-post");
  const canonical = canonicalizeUrl(input.url);
  const externalId = hashUrl(canonical);

  const existing = await deps.rawItemsRepo.findBySourceAndExternalId("manual", externalId);

  let enriched: { title?: string; author?: string; content?: string } = {};
  try {
    enriched = await deps.enrichUrl(input.url);
  } catch {
    // EDGE-004: fall back to URL as title on enrichment failure
  }

  const title = input.title ?? enriched.title ?? input.url;

  const row = await deps.rawItemsRepo.upsertManualItem({
    sourceType: "manual",
    externalId,
    url: input.url,
    title,
    author: enriched.author ?? null,
    content: enriched.content ?? null,
    collectedAt: new Date(),
    engagement: { points: 0, commentCount: 0 },
    metadata: { comments: [] } satisfies RawItemMetadata,
  });

  return {
    id: row.id,
    url: row.url,
    title: row.title,
    sourceType: "manual",
    alreadyExisted: existing !== null,
  };
}

export function createEnrichUrlFromHydrate(
  hydrateAddedPostFn: (url: string, sourceType: "web", options?: { signal?: AbortSignal }) => Promise<RankedItem>,
): EnrichUrlFn {
  return async (url: string) => {
    const result = await hydrateAddedPostFn(url, "web");
    const title = result.recap?.title ?? result.title;
    const author = result.author ?? undefined;
    const content = result.content ?? undefined;
    return { title, author, content };
  };
}
