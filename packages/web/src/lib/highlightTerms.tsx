import type { ReactNode } from "react";

export function highlightTerms(text: string, terms: string[]): ReactNode[] {
  if (!text) return [text];
  const escaped = terms
    .filter((t) => typeof t === "string" && t.trim().length > 0)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (escaped.length === 0) return [text];
  const re = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(re);
  return parts.map((p, i) =>
    i % 2 === 1 ? <mark key={i} className="archive-search-mark">{p}</mark> : p,
  );
}
