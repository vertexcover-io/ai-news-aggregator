const META_TAG_RE = /<meta\b[^>]*>/gi;
const LINK_TAG_RE = /<link\b[^>]*>/gi;
const BASE_TAG_RE = /<base\b[^>]*\bhref=(["'])([^"']*)\1[^>]*>/i;

function attr(tag: string, name: string): string | null {
  const re = new RegExp(`\\b${name}=(["'])([^"']*)\\1`, "i");
  const m = re.exec(tag);
  if (!m) return null;
  return m[2];
}

function decodeAmp(s: string): string {
  return s.replaceAll("&amp;", "&");
}

function resolveAbsolute(raw: string, baseUrl: string): string | null {
  const decoded = decodeAmp(raw.trim());
  if (!decoded) return null;
  if (decoded.startsWith("data:")) return null;
  try {
    const u = new URL(decoded, baseUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function extractFallbackImage(html: string, baseUrl: string): string | null {
  const baseMatch = BASE_TAG_RE.exec(html);
  let effectiveBase = baseUrl;
  if (baseMatch) {
    const baseHref = baseMatch[2];
    if (baseHref) {
      try {
        effectiveBase = new URL(baseHref, baseUrl).toString();
      } catch { /* keep baseUrl */ }
    }
  }

  const metas = html.match(META_TAG_RE) ?? [];
  let ogImage: string | null = null;
  let twImage: string | null = null;
  for (const tag of metas) {
    const property = attr(tag, "property");
    const name = attr(tag, "name");
    const content = attr(tag, "content");
    if (!content) continue;
    if (!ogImage && property?.toLowerCase() === "og:image") {
      ogImage = resolveAbsolute(content, effectiveBase);
    }
    if (!twImage && (name?.toLowerCase() === "twitter:image" || name?.toLowerCase() === "twitter:image:src")) {
      twImage = resolveAbsolute(content, effectiveBase);
    }
  }
  if (ogImage) return ogImage;
  if (twImage) return twImage;

  const links = html.match(LINK_TAG_RE) ?? [];
  for (const tag of links) {
    const rel = attr(tag, "rel")?.toLowerCase();
    if (rel === "icon" || rel === "shortcut icon") {
      const href = attr(tag, "href");
      if (href) {
        const resolved = resolveAbsolute(href, effectiveBase);
        if (resolved) return resolved;
      }
    }
  }

  return null;
}
