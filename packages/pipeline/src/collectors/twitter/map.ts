import type { RawItemInsert } from "@newsletter/shared/db";
import type { NormalizedTweet } from "@pipeline/collectors/twitter/types.js";

const TITLE_MAX = 80;

function makeTitle(fullText: string): string {
  const collapsed = fullText.replace(/\s+/g, " ").trim();
  if (collapsed.length <= TITLE_MAX) return collapsed;
  return `${collapsed.slice(0, TITLE_MAX - 1)}…`;
}

export function tweetToRawItem(t: NormalizedTweet): RawItemInsert {
  const external =
    typeof t.externalUrl === "string" && t.externalUrl.length > 0 ? t.externalUrl : undefined;
  return {
    sourceType: "twitter",
    externalId: t.id,
    title: makeTitle(t.fullText),
    url: external ?? t.url,
    sourceUrl: external ? t.url : undefined,
    author: t.authorHandle,
    content: t.fullText,
    imageUrl: t.photoUrls[0] ?? null,
    publishedAt: new Date(t.createdAt),
    engagement: {
      points: t.likeCount,
      commentCount: t.retweetCount + t.replyCount + t.quoteCount,
    },
    metadata: { comments: [] },
  };
}
