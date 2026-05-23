import type { ReactElement } from "react";
import type { PublicMustReadEntry } from "@newsletter/shared/types";

export interface MustReadEntryViewProps {
  entry: PublicMustReadEntry;
}

const addedFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function formatAddedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return addedFormatter.format(date);
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

function bylineText(
  author: string | null,
  year: number | null,
): string | null {
  if (author && year != null) return `${author} · ${String(year)}`;
  if (author) return author;
  if (year != null) return String(year);
  return null;
}

export function MustReadEntryView({ entry }: MustReadEntryViewProps): ReactElement {
  const byline = bylineText(entry.author, entry.year);
  const host = hostFromUrl(entry.url);

  return (
    <article
      data-entry-id={entry.id}
      className="py-10 pb-19 border-b border-[#e7e2d6] first:pt-0 last:border-b-0"
    >
      <div className="font-mono text-[11.5px] font-medium tracking-[0.18em] uppercase text-[#6b6557]">
        ADDED: {formatAddedAt(entry.addedAt)}
      </div>
      <h3 className="font-serif font-medium text-[28px] leading-[1.18] tracking-[-0.012em] text-[#14110d] mt-4 mb-0">
        {entry.title}
      </h3>
      {byline ? (
        <div className="font-mono text-[12px] font-normal tracking-[0.16em] uppercase text-[#6b6557] mt-2.5">
          {byline}
        </div>
      ) : null}
      <p className="font-serif italic font-normal text-[18px] leading-[1.55] text-[#2a261f] mt-5 mb-0 max-w-[580px]">
        {entry.annotation}
      </p>
      <a
        href={entry.url}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-[12px] font-normal tracking-[0.14em] lowercase text-[#8c3a1e] mt-5 inline-block transition-colors hover:text-[#14110d]"
      >
        → {host}
      </a>
    </article>
  );
}
