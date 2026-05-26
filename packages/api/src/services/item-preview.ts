import { MARKDOWN_EXCERPT_MAX } from "@newsletter/shared/constants";
import type { ItemPreview } from "@newsletter/shared/types";
import type { RawItemMetadata } from "@newsletter/shared";

export interface PreviewRow {
  sourceType: string;
  url: string;
  sourceUrl: string | null;
  content: string | null;
  author: string | null;
  metadata: RawItemMetadata;
}

export function buildItemPreview(row: PreviewRow): ItemPreview {
  if (row.sourceType === "twitter") {
    const qt = row.metadata.quotedTweet;
    return {
      kind: "tweet",
      handle: row.author ?? "",
      text: row.content ?? "",
      createdAt: null,
      photoUrls: qt?.photoUrls ?? [],
      url: row.sourceUrl ?? row.url,
      quoted: qt ? { handle: qt.authorHandle, text: qt.fullText } : null,
    };
  }

  const enriched = row.metadata.enrichedLink;
  if (enriched?.status === "ok") {
    return {
      kind: "link",
      title: enriched.title ?? null,
      byline: enriched.byline ?? null,
      description: enriched.description ?? null,
      imageUrl: enriched.imageUrl ?? null,
      domain: enriched.domain ?? null,
      markdownExcerpt: enriched.markdown != null
        ? enriched.markdown.slice(0, MARKDOWN_EXCERPT_MAX)
        : null,
      url: enriched.url,
    };
  }

  return { kind: "none" };
}
