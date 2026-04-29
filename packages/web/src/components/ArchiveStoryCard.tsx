import { useState, type ReactElement } from "react";
import type { RankedItem } from "@newsletter/shared";

interface ArchiveStoryCardProps {
  item: RankedItem;
  rank: number;
  totalCount: number;
}

function formatDate(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

function formatSourceDate(publishedAt: string | null): string {
  return formatDate(publishedAt).toUpperCase();
}

function formatRank(n: number): string {
  return n < 10 ? `0${String(n)}` : String(n);
}

function truncateHost(url: string): string {
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return "";
  }
  return host.length <= 28 ? host : host.slice(0, 27) + "\u2026";
}

export function ArchiveStoryCard({
  item,
  rank,
  totalCount,
}: ArchiveStoryCardProps): ReactElement {
  const [imgError, setImgError] = useState(false);
  const showImage = Boolean(item.imageUrl) && !imgError;

  const dateStr = formatSourceDate(item.publishedAt);
  const parts: string[] = [item.sourceType.toUpperCase(), dateStr];
  if (item.author) {
    parts[1] = `${dateStr} · BY ${item.author.toUpperCase()}`;
  }
  if (item.engagement.points > 0) parts.push(`▲ ${String(item.engagement.points)}`);
  if (item.engagement.commentCount > 0)
    parts.push(`${String(item.engagement.commentCount)} COMMENTS`);
  const eyebrow = parts.join(" · ");

  const isLead = rank === 1;
  const displayNumClass = isLead
    ? "font-serif font-medium leading-none text-neutral-900 text-5xl"
    : "font-serif font-medium leading-none text-neutral-900 text-4xl";
  const headlineClass = isLead
    ? "font-serif font-medium leading-tight tracking-tight text-neutral-900 text-4xl md:text-5xl"
    : "font-serif font-medium leading-tight tracking-tight text-neutral-900 text-2xl md:text-3xl";
  const ledeClass = isLead
    ? "font-serif text-xl italic leading-relaxed text-neutral-700"
    : "font-serif text-lg italic leading-relaxed text-neutral-700";
  const rationaleClass = "font-serif text-lg leading-relaxed text-neutral-700";

  return (
    <article
      className={`grid grid-cols-1 md:grid-cols-[120px_minmax(0,1fr)_120px] gap-3 md:gap-10 border-b border-[#1A1A1A1A] py-8 md:py-14`}
    >
      {/* Left rail — inline row on mobile, vertical column on desktop */}
      <div
        data-rail="left"
        className="flex md:flex order-1 md:order-none flex-row md:flex-col items-center md:items-start gap-3 md:gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-stone-500"
      >
        <span>N°</span>
        <span className={displayNumClass}>{formatRank(rank)}</span>
        {isLead && (
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#8C3A1E]">
            LEAD STORY
          </span>
        )}
      </div>

      {/* Middle */}
      <div className="flex flex-col gap-4 min-w-0 order-2 md:order-none">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-neutral-500">
          {eyebrow}
        </p>

        <h2 className={headlineClass}>
          <a href={item.url} target="_blank" rel="noopener noreferrer">
            {item.title}
          </a>
        </h2>

        {showImage && item.imageUrl && (
          <img
            src={item.imageUrl}
            alt=""
            referrerPolicy="no-referrer"
            className={`max-w-full w-full border border-[#1A1A1A14] object-cover ${
              isLead
                ? "max-h-[60vw] sm:max-h-[260px] md:max-h-[320px]"
                : "max-h-[60vw] sm:max-h-[200px] md:max-h-[220px]"
            }`}
            onError={() => {
              setImgError(true);
            }}
          />
        )}

        {item.recap ? (
          <>
            <p className={ledeClass}>{item.recap.summary}</p>

            {item.recap.bullets.length >= 1 && (
              <div className="pt-2">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#8C3A1E]">
                  UNPACKED
                </p>
                <ul className="mt-3 space-y-2">
                  {item.recap.bullets.map((b) => (
                    <li
                      key={b}
                      className="flex gap-3 font-sans text-sm leading-relaxed text-neutral-700"
                    >
                      <span aria-hidden="true" className="text-[#8C3A1E]">
                        —
                      </span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {item.recap.bottomLine && (
              <div className="flex gap-4 pt-2">
                <div aria-hidden="true" className="w-[3px] self-stretch bg-[#8C3A1E]" />
                <div className="px-4 sm:px-6 md:px-8">
                  <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#8C3A1E]">
                    BOTTOM LINE
                  </p>
                  <p className="mt-1 font-serif text-lg italic leading-relaxed text-neutral-900">
                    {item.recap.bottomLine}
                  </p>
                </div>
              </div>
            )}
          </>
        ) : (
          <p className={rationaleClass}>{item.rationale}</p>
        )}

        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 pt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-neutral-900 underline"
        >
          READ THE ORIGINAL{" "}
          <span aria-hidden="true" className="text-[#8C3A1E]">
            →
          </span>
        </a>
      </div>

      {/* Right rail — below body on mobile, vertical column on desktop */}
      <div
        data-rail="right"
        className="flex md:flex order-3 md:order-none mt-2 md:mt-0 font-mono text-[11px] text-neutral-500 uppercase tracking-[0.18em] flex-row md:flex-col items-center md:items-start gap-3 md:gap-1"
      >
        <span>
          {formatRank(rank)} / {formatRank(totalCount)}
        </span>
        <span>{truncateHost(item.url)}</span>
      </div>
    </article>
  );
}
