import type { EnrichedLinkContent, EnrichmentSkipReason } from "@newsletter/shared";
import type { RawItemPreStamp as RawItemInsert } from "@pipeline/repositories/raw-items.js";
import { canonicalizeFetchUrl } from "@newsletter/shared/services/url-safety";


const SAME_PLATFORM_HOSTS = [
  "reddit.com",
  "redd.it",
  "news.ycombinator.com",
  "x.com",
  "twitter.com",
  "t.co",
] as const;

const NON_HTML_MEDIA_HOSTS = [
  "youtube.com",
  "youtu.be",
  "vimeo.com",
  "imgur.com",
  "i.imgur.com",
  "i.redd.it",
] as const;

const NON_HTML_MEDIA_EXTENSIONS = [
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".mp4",
  ".mov",
  ".webm",
  ".mp3",
  ".zip",
  ".tar",
  ".gz",
  ".dmg",
  ".exe",
] as const;

const TRACKING_PARAM_PATTERNS: RegExp[] = [
  /^utm_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^mc_(cid|eid)$/i,
  /^ref$/i,
  /^source$/i,
];

export type ShouldEnrichResult =
  | { enrich: true; canonical: string }
  | { enrich: false; skipReason: EnrichmentSkipReason; canonical?: string };

export function canonicalizeEnrichmentUrl(url: string): string | null {
  const canonical = canonicalizeFetchUrl(url);
  if (!canonical) return null;
  const parsed = new URL(canonical);
  parsed.hash = "";
  const keys = [...parsed.searchParams.keys()];
  for (const k of keys) {
    if (TRACKING_PARAM_PATTERNS.some((re) => re.test(k))) {
      parsed.searchParams.delete(k);
    }
  }
  return parsed.toString();
}

function hostMatches(host: string, suffixes: readonly string[]): boolean {
  const h = host.toLowerCase();
  return suffixes.some((s) => h === s || h.endsWith(`.${s}`));
}

function pathHasMediaExtension(pathname: string): boolean {
  const p = pathname.toLowerCase();
  return NON_HTML_MEDIA_EXTENSIONS.some((ext) => p.endsWith(ext));
}

export function getContentType(url: string): "html" | "pdf" | "image" | "video" | "other" {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "other";
  }
  const p = parsed.pathname.toLowerCase();
  if (p.endsWith(".pdf")) return "pdf";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp"].some((e) => p.endsWith(e))) return "image";
  if ([".mp4", ".mov", ".webm"].some((e) => p.endsWith(e))) return "video";
  const host = parsed.hostname.toLowerCase();
  if (hostMatches(host, ["youtube.com", "youtu.be", "vimeo.com"])) return "video";
  if (hostMatches(host, ["imgur.com", "i.imgur.com", "i.redd.it"])) return "image";
  return "html";
}

export function shouldEnrich(
  item: RawItemInsert,
  cache: Map<string, EnrichedLinkContent>,
): ShouldEnrichResult {
  if (!item.url || item.url === "" || item.url === item.sourceUrl) {
    return { enrich: false, skipReason: "no-url" };
  }
  const canonical = canonicalizeEnrichmentUrl(item.url);
  if (!canonical) return { enrich: false, skipReason: "invalid-url" };

  const parsed = new URL(canonical);
  const host = parsed.hostname;

  if (hostMatches(host, SAME_PLATFORM_HOSTS)) {
    return { enrich: false, skipReason: "same-platform", canonical };
  }
  if (pathHasMediaExtension(parsed.pathname) || hostMatches(host, NON_HTML_MEDIA_HOSTS)) {
    return { enrich: false, skipReason: "non-html-media", canonical };
  }
  if (cache.has(canonical)) {
    return { enrich: false, skipReason: "cache-hit", canonical };
  }
  return { enrich: true, canonical };
}
