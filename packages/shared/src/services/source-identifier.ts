import type { SourceType } from "../db/schema.js";

interface DeriveArgs {
  readonly sourceType: SourceType;
  readonly url: string | null;
  readonly sourceUrl: string | null;
}

function hostname(url: string | null): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return null;
  }
}

function hostnameFallback(args: DeriveArgs): string {
  return hostname(args.url) ?? hostname(args.sourceUrl) ?? "unknown";
}

export function deriveRawItemIdentifier(args: DeriveArgs): string {
  switch (args.sourceType) {
    case "hn":
      return "news.ycombinator.com";

    case "reddit": {
      const source = args.url ?? args.sourceUrl;
      if (source) {
        const match = /\/r\/([^/?#]+)/i.exec(source);
        if (match) return `r/${match[1]}`;
      }
      return hostnameFallback(args);
    }

    case "twitter": {
      const source = args.url ?? args.sourceUrl;
      if (source) {
        const match = /(?:x\.com|twitter\.com)\/([^/?#]+)\/status\//i.exec(source);
        if (match) return `@${match[1]}`;
      }
      return hostnameFallback(args);
    }

    case "rss":
    case "blog":
    case "newsletter":
      return hostnameFallback(args);

    case "github": {
      const source = args.url ?? args.sourceUrl;
      if (source) {
        const match = /github\.com\/([^/?#]+)\/([^/?#]+)/i.exec(source);
        if (match) return `${match[1]}/${match[2]}`;
      }
      return hostnameFallback(args);
    }

    case "web_search":
      return "web search";

    default: {
      const _exhaustive: never = args.sourceType;
      return _exhaustive;
    }
  }
}
