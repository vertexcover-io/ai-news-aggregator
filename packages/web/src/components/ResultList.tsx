import type { ReactElement } from "react";
import type { RankedItem } from "@newsletter/shared";

interface ResultListProps {
  items: RankedItem[];
}

function formatPublishedAt(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}

export function ResultList({ items }: ResultListProps): ReactElement {
  if (items.length === 0) {
    return (
      <p className="text-gray-600 italic">No items matched your criteria.</p>
    );
  }

  return (
    <ol className="space-y-4">
      {items.map((item, idx) => (
        <li
          key={item.id}
          className="border border-gray-200 rounded p-4 space-y-2"
        >
          <div className="flex items-start gap-3">
            <span className="text-lg font-bold text-gray-400 w-8">
              {idx + 1}
            </span>
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 text-xs rounded bg-gray-100 text-gray-700 uppercase">
                  {item.sourceType}
                </span>
                <span className="text-xs text-gray-500">
                  {formatPublishedAt(item.publishedAt)}
                </span>
                <span className="text-xs text-gray-500">
                  {item.engagement.points} pts · {item.engagement.commentCount}{" "}
                  comments
                </span>
              </div>
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-700 font-medium hover:underline"
              >
                {item.title}
              </a>
              <p className="text-sm text-gray-700">{item.rationale}</p>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
