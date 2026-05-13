import type { RawItemSummary } from "@newsletter/shared";

type SourceType = RawItemSummary["sourceType"];

export const SOURCE_LABELS: Record<SourceType, string> = {
  hn: "HN",
  reddit: "Reddit",
  twitter: "Twitter",
  blog: "Blog",
  rss: "RSS",
  github: "GitHub",
  newsletter: "Newsletter",
};

export const SOURCE_BADGE_CLASSES: Record<SourceType, string> = {
  hn: "bg-orange-100 text-orange-700",
  reddit: "bg-blue-100 text-blue-700",
  blog: "bg-emerald-100 text-emerald-700",
  twitter: "bg-sky-100 text-sky-700",
  rss: "bg-violet-100 text-violet-700",
  github: "bg-gray-100 text-gray-700",
  newsletter: "bg-amber-100 text-amber-700",
};

export const SOURCE_ORDER: readonly SourceType[] = [
  "hn",
  "reddit",
  "twitter",
  "blog",
  "rss",
  "github",
  "newsletter",
];
