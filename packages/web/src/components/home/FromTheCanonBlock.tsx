import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import type { PublicMustReadEntry } from "@newsletter/shared/types";

export interface FromTheCanonBlockProps {
  entry: PublicMustReadEntry;
}

function bylineText(author: string | null, year: number | null): string | null {
  if (author && year != null) return `${author} · ${String(year)}`;
  if (author) return author;
  if (year != null) return String(year);
  return null;
}

export function FromTheCanonBlock({ entry }: FromTheCanonBlockProps): ReactElement {
  const byline = bylineText(entry.author, entry.year);

  return (
    <section
      data-section="from-the-canon"
      className="py-18 text-center"
    >
      <div className="max-w-[680px] mx-auto">
        <div className="font-mono uppercase text-[12px] tracking-[0.2em] text-[#6b6557]">
          FROM THE CANON
        </div>
        <h3 className="mt-8 mb-0 font-serif font-medium text-[clamp(28px,3vw,32px)] leading-[1.1] tracking-[-0.014em] text-[#14110d]">
          <a
            href={entry.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#14110d] hover:text-[#8c3a1e]"
          >
            {entry.title}
          </a>
        </h3>
        {byline ? (
          <div className="mt-3.5 font-mono uppercase text-[11.5px] tracking-[0.16em] text-[#6b6557]">
            {byline}
          </div>
        ) : null}
        <p className="mt-6 mx-auto max-w-[600px] font-serif italic font-normal text-[19px] leading-[1.55] text-[#14110d] tracking-[-0.004em]">
          “{entry.annotation}”
        </p>
        <Link
          to="/must-read"
          className="inline-block mt-6 font-mono uppercase text-[12px] tracking-[0.14em] text-[#8c3a1e] hover:text-[#14110d]"
        >
          Read on Must Read →
        </Link>
      </div>
    </section>
  );
}
