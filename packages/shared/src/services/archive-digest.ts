import type { RankedItemRef } from "../types/index.js";

interface ArchiveDigestRawItem {
  readonly title: string;
  readonly metadata: {
    readonly recap?: {
      readonly title?: string | null;
      readonly summary?: string | null;
    } | null;
  };
}

export interface ReviewedArchiveDigestInput {
  readonly rankedItems: readonly RankedItemRef[];
  readonly rawItemsById: ReadonlyMap<number, ArchiveDigestRawItem>;
  readonly fallbackDigestHeadline: string | null;
  readonly fallbackDigestSummary: string | null;
}

export interface ReviewedArchiveDigest {
  readonly digestHeadline: string | null;
  readonly digestSummary: string | null;
}

function nonEmptyText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.trim().length > 0 ? value : null;
}

export function deriveReviewedArchiveDigest(
  input: ReviewedArchiveDigestInput,
): ReviewedArchiveDigest {
  if (input.rankedItems.length === 0) {
    return {
      digestHeadline: nonEmptyText(input.fallbackDigestHeadline),
      digestSummary: nonEmptyText(input.fallbackDigestSummary),
    };
  }

  const firstRef = input.rankedItems[0];
  const raw = input.rawItemsById.get(firstRef.rawItemId);
  const recap = raw?.metadata.recap;

  return {
    digestHeadline:
      nonEmptyText(firstRef.title) ??
      nonEmptyText(recap?.title) ??
      nonEmptyText(raw?.title) ??
      nonEmptyText(input.fallbackDigestHeadline),
    digestSummary:
      nonEmptyText(firstRef.summary) ??
      nonEmptyText(recap?.summary) ??
      nonEmptyText(input.fallbackDigestSummary),
  };
}
