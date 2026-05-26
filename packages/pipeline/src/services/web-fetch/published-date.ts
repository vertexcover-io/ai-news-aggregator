// Extracts a publish date from structured HTML signals on the original DOM,
// before Readability mutates it. Returns null when no valid date is found.
// Dependency-free: uses native Date only. Natural-language / relative strings
// are Phase 2's job (resolvePublishedDate via chrono-node).

function parseDate(s: string): Date | null {
  if (!s.trim()) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function extractFromJsonLd(doc: Document): Date | null {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const script of Array.from(scripts)) {
    const text = script.textContent;
    if (!text) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      // EDGE-001: malformed JSON — skip this block, try the next one
      continue;
    }

    // Flatten into an array of nodes to check
    let nodes: unknown[];
    if (Array.isArray(parsed)) {
      nodes = parsed;
    } else if (
      parsed !== null &&
      typeof parsed === "object" &&
      "@graph" in parsed &&
      Array.isArray((parsed as Record<string, unknown>)["@graph"])
    ) {
      nodes = (parsed as Record<string, unknown>)["@graph"] as unknown[]; // @graph key requires bracket notation
    } else {
      nodes = [parsed];
    }

    // Find the first node that has a parseable datePublished
    for (const node of nodes) {
      if (node === null || typeof node !== "object") continue;
      const record = node as Record<string, unknown>;
      const dp = record.datePublished;
      if (typeof dp !== "string") continue;
      const date = parseDate(dp);
      if (date !== null) return date;
      // EDGE-002: unparseable datePublished — treat tier as absent, fall through
    }
  }
  return null;
}

const META_SELECTORS = [
  'meta[property="article:published_time"]',
  'meta[name="article:published_time"]',
  'meta[property="og:published_time"]',
  'meta[itemprop="datePublished"]',
  'meta[name="date"]',
  'meta[name="parsely-pub-date"]',
  'meta[name="dc.date.issued"]',
];

function extractFromMeta(doc: Document): Date | null {
  for (const selector of META_SELECTORS) {
    const el = doc.querySelector(selector);
    if (!el) continue;
    const content = el.getAttribute("content");
    if (!content) continue;
    const date = parseDate(content);
    if (date !== null) return date;
  }
  return null;
}

function extractFromTimeElement(doc: Document): Date | null {
  // EDGE-003: only consider <time> elements that have a datetime attribute
  const timeEls = doc.querySelectorAll("time[datetime]");
  for (const el of Array.from(timeEls)) {
    const dt = el.getAttribute("datetime");
    if (!dt) continue;
    const date = parseDate(dt);
    if (date !== null) return date;
  }
  return null;
}

export function extractPublishedAt(doc: Document): Date | null {
  return (
    extractFromJsonLd(doc) ??
    extractFromMeta(doc) ??
    extractFromTimeElement(doc)
  );
}
