/**
 * User-submitted URL ingestion (Chrome extension). A submitted URL becomes a
 * single `manual` raw_items row, stamped with the submitter's tenant and
 * deduped PER TENANT — so it competes as a candidate in that tenant's next run
 * exactly like any collected item. No pipeline change is needed: tenant
 * correctness comes entirely from the tenant-scoped repo handed in here.
 *
 * Enrichment is intentionally light: the extension sends the page's own title,
 * and richer content (link enrichment / recap) is left to the pipeline's normal
 * rank stage during the next run. `enrichUrl` stays injectable so a future
 * version can plug in server-side enrichment; the default is a no-op.
 */
import { createHash } from "node:crypto";
import type { RawItemInsert, SourceType } from "@newsletter/shared/db";

export type EnrichUrlFn = (
  url: string,
) => Promise<{ title?: string; author?: string; content?: string }>;

/** The slice of the (tenant-scoped) raw-items repo this service needs. */
export interface SubmissionRawItemsRepo {
  findBySourceAndExternalId(
    sourceType: SourceType,
    externalId: string,
  ): Promise<{ id: number; url: string; title: string } | null>;
  upsertItems(items: RawItemInsert[]): Promise<void>;
}

export interface CreateSubmissionDeps {
  rawItemsRepo: SubmissionRawItemsRepo;
  /** Tracking-param-stripping canonicalizer (pipeline `canonicalizeUrl`). */
  canonicalizeUrl: (url: string) => string;
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
  const canonical = deps.canonicalizeUrl(input.url);
  const externalId = hashUrl(canonical);

  // Per-tenant dedupe: the repo is tenant-fenced, so this only sees THIS
  // tenant's rows. A different tenant submitting the same URL is independent.
  const existing = await deps.rawItemsRepo.findBySourceAndExternalId(
    "manual",
    externalId,
  );

  let enriched: { title?: string; author?: string; content?: string } = {};
  try {
    enriched = await deps.enrichUrl(input.url);
  } catch {
    // EDGE-004: enrichment is best-effort — fall back to the page/URL title.
  }

  const title = input.title ?? enriched.title ?? input.url;

  const insert: RawItemInsert = {
    sourceType: "manual",
    externalId,
    url: input.url,
    title,
    author: enriched.author ?? null,
    content: enriched.content ?? null,
    collectedAt: new Date(),
    metadata: { comments: [], addedInReview: true },
  };
  await deps.rawItemsRepo.upsertItems([insert]);

  const saved = await deps.rawItemsRepo.findBySourceAndExternalId(
    "manual",
    externalId,
  );
  if (saved === null) {
    throw new Error(`manual submission not found after upsert: ${externalId}`);
  }

  return {
    id: saved.id,
    url: saved.url,
    title: saved.title,
    sourceType: "manual",
    alreadyExisted: existing !== null,
  };
}
