import { parse } from "node-html-parser";

export interface PageMetadata {
  title: string | null;
  author: string | null;
  year: number | null;
}

type JsonLdNode = Record<string, unknown>;

const ARTICLE_TYPES = new Set([
  "Article",
  "NewsArticle",
  "BlogPosting",
  "Report",
  "ScholarlyArticle",
  "TechArticle",
  "SocialMediaPosting",
]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

function parseYear(v: unknown): number | null {
  const s = asString(v);
  if (!s) return null;
  const match = /^(\d{4})/.exec(s);
  if (!match) return null;
  const y = Number(match[1]);
  if (!Number.isFinite(y) || y < 1900 || y > 2100) return null;
  return y;
}

function extractAuthorFromJsonLd(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return asString(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      const name = extractAuthorFromJsonLd(entry);
      if (name) return name;
    }
    return null;
  }
  if (isRecord(value)) {
    return asString(value.name);
  }
  return null;
}

function nodeMatchesArticle(node: JsonLdNode): boolean {
  const t = node["@type"];
  if (typeof t === "string") return ARTICLE_TYPES.has(t);
  if (Array.isArray(t)) return t.some((x) => typeof x === "string" && ARTICLE_TYPES.has(x));
  return false;
}

function flattenJsonLd(raw: unknown): JsonLdNode[] {
  const out: JsonLdNode[] = [];
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const x of v) visit(x);
      return;
    }
    if (!isRecord(v)) return;
    out.push(v);
    const graph = v["@graph"];
    if (Array.isArray(graph)) visit(graph);
  };
  visit(raw);
  return out;
}

function readJsonLdMetadata(html: string): Partial<PageMetadata> {
  const root = parse(html);
  const scripts = root.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    const text = script.text.trim();
    if (!text) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    const nodes = flattenJsonLd(parsed);
    const article = nodes.find(nodeMatchesArticle);
    if (!article) continue;
    const title = asString(article.headline) ?? asString(article.name);
    const author = extractAuthorFromJsonLd(article.author);
    const year = parseYear(article.datePublished ?? article.dateCreated);
    if (title || author || year !== null) {
      return { title, author, year };
    }
  }
  return {};
}

function readMetaContent(
  root: ReturnType<typeof parse>,
  selectors: readonly string[],
): string | null {
  for (const sel of selectors) {
    const el = root.querySelector(sel);
    if (!el) continue;
    const content = el.getAttribute("content");
    const value = asString(content);
    if (value) return value;
  }
  return null;
}

function readTitleElement(root: ReturnType<typeof parse>): string | null {
  const el = root.querySelector("title");
  if (!el) return null;
  return asString(el.text);
}

export function extractPageMetadata(html: string, _url: string): PageMetadata {
  const ld = readJsonLdMetadata(html);
  if (ld.title || ld.author || ld.year !== undefined) {
    return {
      title: ld.title ?? null,
      author: ld.author ?? null,
      year: ld.year ?? null,
    };
  }

  const root = parse(html);
  const ogTitle = readMetaContent(root, ['meta[property="og:title"]']);
  const ogAuthor = readMetaContent(root, ['meta[property="article:author"]']);
  const ogYear = parseYear(
    readMetaContent(root, ['meta[property="article:published_time"]']),
  );

  const metaAuthor = readMetaContent(root, ['meta[name="author"]']);
  const metaYear = parseYear(readMetaContent(root, ['meta[name="date"]']));

  const title = ogTitle ?? readTitleElement(root);
  const author = ogAuthor ?? metaAuthor;
  const year = ogYear ?? metaYear;

  return { title, author, year };
}
