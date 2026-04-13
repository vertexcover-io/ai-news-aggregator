import { useState, type ReactElement } from "react";
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
  const [imgError, setImgError] = useState(false);
  const showImage = Boolean(item.imageUrl) && !imgError;

  return (
    <article className="space-y-4">
      {showImage && item.imageUrl && (
        <img
          src={item.imageUrl}
          alt=""
          className="w-full rounded-lg object-cover max-h-80"
          onError={() => { setImgError(true); }}
        />
      )}

      <h2 className="text-xl font-bold leading-snug">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-900 hover:text-blue-700 hover:underline"
        >
          {item.title}
        </a>
      </h2>

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

      <p className="text-sm text-gray-700 leading-relaxed">
        <span className="font-semibold">The Recap: </span>
        {item.recap ? item.recap.summary : item.rationale}
      </p>

      {item.recap && (
        <>
          <div>
            <p className="text-sm font-semibold text-gray-900 mb-1">Unpacked:</p>
            <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
              {item.recap.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          </div>

          <p className="text-sm text-gray-700 italic">
            <span className="font-semibold not-italic">Bottom line: </span>
            {item.recap.bottomLine}
          </p>
        </>
      )}

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
