import type { SourceType } from "../db/schema.js";

export const SOURCE_TYPE_SECTION_LABELS: Record<SourceType, string> = {
  hn: "Hacker News",
  reddit: "Reddit",
  twitter: "X (Twitter)",
  rss: "RSS Feeds",
  github: "GitHub",
  blog: "Engineering Blogs",
  newsletter: "Newsletters",
  web_search: "Web Search",
};

export const SOURCE_TYPE_ORDER: readonly SourceType[] = [
  "hn",
  "reddit",
  "twitter",
  "rss",
  "github",
  "blog",
  "newsletter",
  "web_search",
] as const;
