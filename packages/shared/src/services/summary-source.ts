import type { EnrichedLinkContent } from "../types/index.js";
import type { SourceType } from "../db/schema.js";

export type SummarySource =
  | { kind: "enriched"; hostname: string; url: string; markdown: string }
  | { kind: "native"; content: string }
  | { kind: "none" };

export function deriveHostname(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  return hostname.length > 0 ? hostname : null;
}

export function pickSummarySource(
  content: string | null,
  enrichedLink: EnrichedLinkContent | undefined | null,
): SummarySource {
  if (enrichedLink?.status === "ok" && enrichedLink.markdown && enrichedLink.markdown.length > 0) {
    const hostname = deriveHostname(enrichedLink.url);
    if (hostname !== null) {
      return { kind: "enriched", hostname, url: enrichedLink.url, markdown: enrichedLink.markdown };
    }
  }
  if (content !== null && content.length > 0) {
    return { kind: "native", content };
  }
  return { kind: "none" };
}

export const PLATFORM_LABEL: Record<SourceType, string> = {
  hn: "Hacker News",
  reddit: "Reddit",
  rss: "RSS",
  blog: "Blog",
  twitter: "X / Twitter",
  github: "GitHub",
  newsletter: "Newsletter",
  web_search: "Web Search",
};

export function getPlatformLabel(sourceType: SourceType): string {
  return PLATFORM_LABEL[sourceType];
}
