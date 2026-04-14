import { useState, type ReactElement } from "react";
import type { RankedItem } from "@newsletter/shared";

interface ArchiveStoryCardProps {
  item: RankedItem;
  rank: number;
}

const SOURCE_COLORS: Record<string, string> = {
  hn: "bg-orange-100 text-orange-700",
  reddit: "bg-blue-100 text-blue-700",
  blog: "bg-emerald-100 text-emerald-700",
  twitter: "bg-sky-100 text-sky-700",
  rss: "bg-violet-100 text-violet-700",
  github: "bg-gray-100 text-gray-700",
  newsletter: "bg-amber-100 text-amber-700",
};

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

export function ArchiveStoryCard({
  item,
}: ArchiveStoryCardProps): ReactElement {
  const [imgError, setImgError] = useState(false);
  const showImage = Boolean(item.imageUrl) && !imgError;
  const badgeColor = SOURCE_COLORS[item.sourceType] ?? "bg-gray-100 text-gray-700";

  return (
    <article className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      {showImage && item.imageUrl && (
        <img
          src={item.imageUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="w-full object-cover max-h-64"
          onError={() => {
            setImgError(true);
          }}
        />
      )}

      <div className="p-6 space-y-5">
        <h2 className="text-2xl font-bold leading-snug tracking-tight">
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-900 hover:text-blue-700 transition-colors"
          >
            {item.title}
          </a>
        </h2>

        <div className="flex items-center gap-3 text-sm text-gray-400 flex-wrap">
          <span
            className={`px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase ${badgeColor}`}
          >
            {item.sourceType}
          </span>
          {item.publishedAt && (
            <span>{formatDate(item.publishedAt)}</span>
          )}
          {item.author && <span>by {item.author}</span>}
          {item.engagement.points > 0 && (
            <span>▲ {item.engagement.points}</span>
          )}
          {item.engagement.commentCount > 0 && (
            <span>💬 {item.engagement.commentCount}</span>
          )}
        </div>

        <div className="bg-gray-50 rounded-lg p-4">
          <p className="text-base text-gray-700 leading-relaxed">
            <span className="font-semibold text-gray-900">The Recap: </span>
            {item.recap ? item.recap.summary : item.rationale}
          </p>
        </div>

        {item.recap && (
          <>
            <div>
              <p className="text-sm font-semibold text-gray-900 mb-2 uppercase tracking-wide">
                Unpacked
              </p>
              <ul className="space-y-2 pl-1">
                {item.recap.bullets.map((bullet) => (
                  <li
                    key={bullet}
                    className="text-base text-gray-600 leading-relaxed flex gap-2"
                  >
                    <span className="text-gray-300 mt-0.5">•</span>
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="border-l-4 border-gray-200 pl-4 py-1">
              <p className="text-base text-gray-600 italic">
                <span className="font-semibold not-italic text-gray-900">
                  Bottom line:{" "}
                </span>
                {item.recap.bottomLine}
              </p>
            </div>
          </>
        )}

        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline transition-colors"
        >
          Read more →
        </a>
      </div>
    </article>
  );
}
