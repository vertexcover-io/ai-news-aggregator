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
  const py = isLead ? "py-14" : "py-10";
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
      className={`flex flex-col gap-6 border-b border-[#1A1A1A1A] ${py} md:grid md:grid-cols-[120px_minmax(0,1fr)_120px] md:gap-10`}
    >
      {/* Left rail */}
      <div data-rail="left" className="hidden md:flex flex-col gap-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-neutral-500">
          N°
        </span>
        <span className={displayNumClass}>{formatRank(rank)}</span>
        {isLead && (
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#8C3A1E]">
            LEAD STORY
          </span>
        )}
      </div>

      {/* Middle */}
      <div className="flex flex-col gap-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-neutral-500">
          <span className="md:hidden">N°{formatRank(rank)} · </span>
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
            className="w-full border border-[#1A1A1A14] object-cover"
            style={{ maxHeight: isLead ? 320 : 220 }}
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
                <div>
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

      {/* Right rail */}
      <div
        data-rail="right"
        className="hidden md:flex font-mono text-[11px] text-neutral-500 uppercase tracking-[0.18em] flex-col gap-1"
      >
        <span>
          {formatRank(rank)} / {formatRank(totalCount)}
        </span>
        <span>{truncateHost(item.url)}</span>
      </div>
    </article>
  );
}
