import type { PreReviewSnapshot } from "@newsletter/shared/review-edits";
import type { RankedItemRef } from "@newsletter/shared/types";

export function buildPreReviewSnapshot(args: {
  rankedItems: readonly RankedItemRef[];
  digestHeadline: string | null;
  digestSummary: string | null;
  hook: string | null;
  twitterSummary: string | null;
  now?: () => Date;
}): PreReviewSnapshot {
  const now = args.now ?? (() => new Date());
  const recap: PreReviewSnapshot["recap"] = {};
  for (const item of args.rankedItems) {
    recap[item.rawItemId] = {
      title: item.title ?? "",
      summary: item.summary ?? "",
      bullets: item.bullets ?? [],
      bottomLine: item.bottomLine ?? "",
    };
  }
  return {
    capturedAt: now().toISOString(),
    rankedItemIds: args.rankedItems.map((i) => i.rawItemId),
    recap,
    digestMeta: {
      headline: args.digestHeadline,
      summary: args.digestSummary,
      hook: args.hook,
      twitterSummary: args.twitterSummary,
    },
  };
}
