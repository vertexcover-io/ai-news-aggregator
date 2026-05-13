import type { ReactElement } from "react";

interface ArchivePageHeaderProps {
  startedAt: string;
  storyCount: number;
  topStoryTitle: string | null;
  digestHeadline?: string | null;
  digestSummary?: string | null;
  readingTimeMin?: number;
}

export function formatLedgerEyebrow(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).formatToParts(d);

  const weekday = (parts.find((p) => p.type === "weekday")?.value ?? "").toUpperCase();
  const month = (parts.find((p) => p.type === "month")?.value ?? "").toUpperCase();
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  const year = parts.find((p) => p.type === "year")?.value ?? "";

  return `${weekday} · ${month} ${day} · ${year}`;
}

export function pickHeadline(
  topStoryTitle: string | null,
  digestHeadline?: string | null,
): string {
  if (topStoryTitle !== null && topStoryTitle !== "") return topStoryTitle;
  if (digestHeadline !== null && digestHeadline !== undefined && digestHeadline !== "") {
    return digestHeadline;
  }
  return "An archived issue";
}

export function ArchivePageHeader({
  startedAt,
  storyCount,
  topStoryTitle,
  digestHeadline,
  digestSummary,
  readingTimeMin,
}: ArchivePageHeaderProps): ReactElement {
  const dek =
    digestSummary !== null && digestSummary !== undefined && digestSummary !== ""
      ? digestSummary
      : null;
  const storyLabel = storyCount === 1 ? "1 story" : `${String(storyCount)} stories`;
  const meta =
    readingTimeMin !== undefined
      ? `${storyLabel} · ${String(readingTimeMin)} min read`
      : storyLabel;

  return (
    <header className="text-center mt-2 mb-6">
      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#8c3a1e] m-0 mb-[18px]">
        {formatLedgerEyebrow(startedAt)}
      </p>
      <h1 className="font-serif font-semibold leading-[1.05] tracking-[-0.012em] text-[#14110d] text-[34px] sm:text-[42px] md:text-[50px] m-0 mb-[18px]">
        {pickHeadline(topStoryTitle, digestHeadline)}
      </h1>
      {dek !== null ? (
        <p className="mx-auto mt-0 mb-[18px] max-w-[56ch] font-serif text-[19px] italic leading-[1.5] text-[#2a261f]">
          {dek}
        </p>
      ) : null}
      <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-[#6b6557] m-0">
        {meta}
      </p>
    </header>
  );
}
