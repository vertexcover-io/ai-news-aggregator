import type { ReactElement } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2 } from "lucide-react";
import type { RankedItem } from "@newsletter/shared";
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

interface ReviewCardProps {
  item: RankedItem;
  rank: number;
  isAdded: boolean;
  onDelete: (id: number) => void;
}

export function ReviewCard({
  item,
  rank,
  isAdded,
  onDelete,
}: ReviewCardProps): ReactElement {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const badgeColor =
    SOURCE_COLORS[item.sourceType] ?? "bg-gray-100 text-gray-700";

  return (
    <article
      ref={setNodeRef}
      style={style}
      data-added={isAdded ? "true" : undefined}
      className={cn(
        "flex items-start gap-4 rounded-lg border bg-white px-4 py-3 shadow-sm",
        isAdded && "border-l-4 border-l-emerald-400",
        isDragging && "opacity-70",
      )}
    >
      <button
        type="button"
        aria-label="Drag to reorder"
        className="cursor-grab touch-none p-1 text-gray-400 hover:text-gray-600"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>

      <div
        aria-label="rank"
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-semibold text-white"
      >
        {rank}
      </div>

      <div className="size-12 shrink-0 overflow-hidden rounded bg-gray-100">
        {item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt=""
            className="size-full object-cover"
          />
        ) : null}
      </div>

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
            <span>{item.engagement.points} points</span>
          )}
          {item.engagement.commentCount > 0 && (
            <span>{item.engagement.commentCount} comments</span>
          )}
          {isAdded && (
            <span className="text-emerald-600 font-medium">
              + Added by you
            </span>
          )}
        </div>
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-0.5 block font-semibold text-gray-900 hover:underline truncate"
        >
          {item.title}
        </a>
        <p className="mt-1 text-sm text-gray-600 line-clamp-2">
          {item.rationale}
        </p>
      </div>

      <div className="flex flex-col items-end gap-2">
        {isAdded ? (
          <span className="text-xs text-emerald-600 font-medium">
            Added by you
          </span>
        ) : (
          <div className="text-right">
            <div className="text-lg font-bold text-emerald-600">
              {(item.score * 10).toFixed(1)}
            </div>
            <div className="text-[10px] uppercase text-muted-foreground">
              score
            </div>
          </div>
        )}
        <button
          type="button"
          aria-label={`Remove ${item.title}`}
          onClick={() => {
            onDelete(item.id);
          }}
          className="text-red-500 hover:text-red-700"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
    </article>
  );
}
