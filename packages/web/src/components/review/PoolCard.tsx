import type { ReactElement } from "react";
import { ArrowUpCircle, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { PoolItem } from "@newsletter/shared";
import { cn } from "@/lib/utils";

const SOURCE_COLORS: Record<string, string> = {
  hn: "bg-orange-100 text-orange-700",
  reddit: "bg-blue-100 text-blue-700",
  blog: "bg-emerald-100 text-emerald-700",
  web: "bg-emerald-100 text-emerald-700",
  twitter: "bg-sky-100 text-sky-700",
  rss: "bg-violet-100 text-violet-700",
  github: "bg-gray-100 text-gray-700",
  newsletter: "bg-amber-100 text-amber-700",
};

interface PoolCardProps {
  item: PoolItem;
  onPromote: (rawItemId: number, title: string) => void;
  isPromoting: boolean;
  isSaveInFlight: boolean;
}

export function PoolCard({
  item,
  onPromote,
  isPromoting,
  isSaveInFlight,
}: PoolCardProps): ReactElement {
  const badgeColor =
    SOURCE_COLORS[item.sourceType] ?? "bg-gray-100 text-gray-700";

  const relativeTime = item.publishedAt
    ? formatDistanceToNow(new Date(item.publishedAt)) + " ago"
    : "Unknown date";

  const promoteDisabled = isSaveInFlight || isPromoting;

  return (
    <article className="flex items-start gap-3 rounded-lg border bg-white px-4 py-3 shadow-sm">
      {item.imageUrl ? (
        <div className="size-10 shrink-0 overflow-hidden rounded bg-gray-100">
          <img
            src={item.imageUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="size-full object-cover"
          />
        </div>
      ) : null}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className={cn(
              "px-2 py-0.5 rounded-full text-xs font-semibold uppercase",
              badgeColor,
            )}
          >
            {item.sourceType}
          </span>
          {item.engagement.points > 0 && (
            <span>{item.engagement.points} pts</span>
          )}
          {item.engagement.commentCount > 0 && (
            <span>{item.engagement.commentCount} comments</span>
          )}
          <span className="text-gray-400">{relativeTime}</span>
        </div>
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-0.5 inline-flex items-center font-medium text-gray-900 hover:underline truncate text-sm min-h-[44px] w-full"
        >
          {item.title}
        </a>
      </div>

      <button
        type="button"
        aria-label={`Promote ${item.title}`}
        disabled={promoteDisabled}
        onClick={() => {
          onPromote(item.id, item.title);
        }}
        className={cn(
          "shrink-0 p-1 rounded transition-colors inline-flex items-center justify-center min-h-[44px] min-w-[44px]",
          promoteDisabled
            ? "text-gray-300 cursor-not-allowed"
            : "text-blue-500 hover:text-blue-700 hover:bg-blue-50",
        )}
      >
        {isPromoting ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <ArrowUpCircle className="size-5" />
        )}
      </button>
    </article>
  );
}
