import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
// turndown-plugin-gfm ships no types; see src/types/turndown-plugin-gfm.d.ts
import { gfm } from "turndown-plugin-gfm";
import type { ConvertInput, ConvertResult } from "@pipeline/services/web-fetch/types.js";

export const HEALTHY_TEXT_LENGTH = 200;

function makeTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "_",
  });
  td.use(gfm);
  return td;
}

function resolveAbsolute(raw: string, effectiveBase: string): string | null {
  const decoded = raw.replaceAll("&amp;", "&").trim();
  if (!decoded) return null;
  if (decoded.startsWith("data:")) return null;
  try {
    const u = new URL(decoded, effectiveBase);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

function extractImageUrl(doc: Document, baseUrl: string): string | null {
  // Determine effective base from <base href> if present
  let effectiveBase = baseUrl;
  const baseEl = doc.querySelector("base[href]");
  if (baseEl) {
    const baseHref = baseEl.getAttribute("href");
    if (baseHref) {
      try {
        effectiveBase = new URL(baseHref, baseUrl).toString();
      } catch { /* keep baseUrl */ }
    }
  }

  // 1. og:image
  const ogImage = doc.querySelector('meta[property="og:image"]');
  if (ogImage) {
    const content = ogImage.getAttribute("content");
    if (content) {
      const resolved = resolveAbsolute(content, effectiveBase);
      if (resolved) return resolved;
    }
  }

  // 2. twitter:image or twitter:image:src
  const twImage =
    doc.querySelector('meta[name="twitter:image"]') ??
    doc.querySelector('meta[name="twitter:image:src"]');
  if (twImage) {
    const content = twImage.getAttribute("content");
    if (content) {
      const resolved = resolveAbsolute(content, effectiveBase);
      if (resolved) return resolved;
    }
  }

  // 3. favicon: rel="icon" or rel="shortcut icon"
  const links = doc.querySelectorAll("link");
  for (const link of links) {
    const rel = link.getAttribute("rel")?.toLowerCase();
    if (rel === "icon" || rel === "shortcut icon") {
      const href = link.getAttribute("href");
      if (href) {
        const resolved = resolveAbsolute(href, effectiveBase);
        if (resolved) return resolved;
      }
    }
  }

  return null;
}

export function convert(input: ConvertInput): ConvertResult {
  const { html, baseUrl, mode } = input;
  const td = makeTurndown();

  if (mode === "article") {
    // Parse into a fresh JSDOM — pass baseUrl so relative links resolve
    const dom = new JSDOM(html, { url: baseUrl });
    const doc = dom.window.document;

    // Extract image from ORIGINAL doc before Readability mutates it
    const imageUrl = extractImageUrl(doc, baseUrl);

    // Clone for Readability (Readability.parse() is destructive)
    const docClone = doc.cloneNode(true) as Document;
    const parsed = new Readability(docClone).parse();

    if (!parsed) {
      return { markdown: "", title: null, byline: null, imageUrl, textLength: 0 };
    }

    const markdown = td.turndown(parsed.content ?? "");
    const textLength = parsed.textContent?.length ?? 0;
    return {
      markdown,
      title: parsed.title ?? null,
      byline: parsed.byline ?? null,
      imageUrl,
      textLength,
    };
  }

  // listing mode
  const dom = new JSDOM(html, { url: baseUrl });
  const doc = dom.window.document;

  // Extract image from original DOM (before stripping)
  const imageUrl = extractImageUrl(doc, baseUrl);

  // Strip layout noise
  const stripTags = ["script", "style", "nav", "footer", "aside"];
  for (const tag of stripTags) {
    for (const el of Array.from(doc.querySelectorAll(tag))) {
      el.remove();
    }
  }

  const bodyHtml = doc.body.innerHTML;
  const markdown = td.turndown(bodyHtml);
  const textLength = doc.body.textContent?.length ?? 0;

  return {
    markdown,
    title: doc.title || null,
    byline: null,
    imageUrl,
    textLength,
  };
}

export function isHealthyResult(r: ConvertResult): boolean {
  return r.textLength >= HEALTHY_TEXT_LENGTH;
}
