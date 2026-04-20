import type { ReactElement } from "react";
import { Link } from "react-router-dom";

interface ArchivePageHeaderProps {
  startedAt: string;
  storyCount: number;
  leadSummary: string | null;
  topStoryTitle: string | null;
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

  return `${weekday} · ${month} ${day}, ${year}`;
}

export function pickHeadline(
  leadSummary: string | null,
  topStoryTitle: string | null,
): string {
  if (leadSummary !== null && leadSummary !== "") return leadSummary;
  if (topStoryTitle !== null && topStoryTitle !== "") return topStoryTitle;
  return "An archived issue";
}

export function ArchivePageHeader({
  startedAt,
  storyCount,
  leadSummary,
  topStoryTitle,
}: ArchivePageHeaderProps): ReactElement {
  return (
    <header className="pt-12 pb-8">
      <p className="font-mono text-xs text-[#8C3A1E] uppercase tracking-widest">
        {formatLedgerEyebrow(startedAt)}
      </p>
      <h1 className="mt-4 font-serif text-4xl font-medium leading-tight tracking-tight text-neutral-900 md:text-5xl">
        {pickHeadline(leadSummary, topStoryTitle)}
      </h1>
      <p className="mt-4 font-mono text-xs text-neutral-500 uppercase tracking-widest">
        {storyCount === 1 ? "1 story" : `${String(storyCount)} stories`}
      </p>
      <Link
        to="/"
        className="mt-6 inline-block font-mono text-xs text-neutral-600 uppercase tracking-widest hover:text-neutral-900"
      >
        ← All issues
      </Link>
    </header>
  );
}
