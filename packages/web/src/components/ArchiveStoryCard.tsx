import type { ReactElement } from "react";
import type { RankedItem } from "@newsletter/shared";

interface ArchiveStoryCardProps {
  item: RankedItem;
  rank: number;
}

function formatDate(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function ArchiveStoryCard({ item, rank }: ArchiveStoryCardProps): ReactElement {
  return (
    <article className="border border-gray-200 rounded-lg p-5 space-y-3 bg-white">
      <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
        <span className="font-bold text-gray-400 w-6 text-right">{rank}</span>
        <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-700 uppercase font-medium">
          {item.sourceType}
        </span>
        {item.publishedAt && <span>{formatDate(item.publishedAt)}</span>}
        {item.author && <span>by {item.author}</span>}
        <span>▲ {item.engagement.points}</span>
        <span>💬 {item.engagement.commentCount}</span>
      </div>

      <h2 className="text-lg font-semibold leading-snug">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-800 hover:underline"
        >
          {item.title}
        </a>
      </h2>

      <p className="text-sm text-gray-700">
        <span className="font-semibold">The Recap: </span>
        {item.rationale}
      </p>

      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block text-sm text-blue-600 hover:underline"
      >
        Read more →
      </a>
    </article>
  );
}
