import { useState } from "react";
import type { ReactElement } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pencil, Trash2 } from "lucide-react";
import type { RankedItem } from "@newsletter/shared";
import { cn } from "@/lib/utils";
import { SOURCE_BADGE_CLASSES } from "@/lib/sourceDisplay";
import { EditableField } from "./EditableField";
import { EditableBulletList } from "./EditableBulletList";

interface ReviewCardProps {
  item: RankedItem;
  rank: number;
  isAdded: boolean;
  onDelete: (id: number) => void;
  onUpdateField: (
    id: number,
    field: "title" | "summary" | "bullets" | "bottomLine" | "imageUrl",
    value: string | string[] | null,
  ) => void;
}

export function ReviewCard({
  item,
  rank,
  isAdded,
  onDelete,
  onUpdateField,
}: ReviewCardProps): ReactElement {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const [editingImageUrl, setEditingImageUrl] = useState(false);
  const [imageUrlDraft, setImageUrlDraft] = useState(item.imageUrl ?? "");

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const badgeColor = SOURCE_BADGE_CLASSES[item.sourceType];

  return (
    <article
      ref={setNodeRef}
      style={style}
      data-added={isAdded ? "true" : undefined}
      className={cn(
        "relative flex flex-wrap items-stretch gap-3 sm:gap-4 rounded-lg border bg-white px-4 py-3 shadow-sm",
        isAdded && "border-l-4 border-l-emerald-400",
        isDragging && "opacity-70",
      )}
    >
      <button
        type="button"
        data-dnd-handle="true"
        aria-label="Drag to reorder"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded text-stone-500 hover:bg-stone-100 cursor-grab active:cursor-grabbing touch-none"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-5 w-5" />
      </button>

      <div
        aria-label="rank"
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-semibold text-white"
      >
        {rank}
      </div>

      <div className="relative size-12 shrink-0 overflow-hidden rounded bg-gray-100 group/thumb">
        {item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="size-full object-cover"
          />
        ) : null}
        {!editingImageUrl && (
          <button
            type="button"
            aria-label="Edit image URL"
            className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover/thumb:opacity-100 transition-opacity"
            onClick={() => {
              setImageUrlDraft(item.imageUrl ?? "");
              setEditingImageUrl(true);
            }}
          >
            <Pencil className="size-3 text-white" />
          </button>
        )}
      </div>
      {editingImageUrl && (
        <div className="absolute top-full left-0 z-10 mt-1 w-64 rounded border bg-white p-2 shadow-md">
          <input
            autoFocus
            type="text"
            value={imageUrlDraft}
            onChange={(e) => { setImageUrlDraft(e.target.value); }}
            onBlur={() => {
              onUpdateField(item.id, "imageUrl", imageUrlDraft || null);
              setEditingImageUrl(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onUpdateField(item.id, "imageUrl", imageUrlDraft || null);
                setEditingImageUrl(false);
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setEditingImageUrl(false);
              }
            }}
            placeholder="Image URL..."
            className="w-full text-xs border-b border-blue-400 focus:outline-none"
          />
        </div>
      )}

      <div className="flex-1 min-w-0 basis-full sm:basis-auto order-last sm:order-none">
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
        <div className="mt-0.5 flex items-start gap-2">
          <div className="flex-1 min-w-0 font-semibold text-gray-900">
            <EditableField
              value={item.title}
              onCommit={(v) => {
                const trimmed = v.trim();
                if (trimmed.length === 0) return;
                onUpdateField(item.id, "title", trimmed);
              }}
              placeholder="Title..."
              className="text-base"
            />
          </div>
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open source"
            className="shrink-0 text-xs text-stone-400 hover:text-stone-700 hover:underline mt-1"
          >
            open ↗
          </a>
        </div>
        {item.recap ? (
          <div className="mt-1 space-y-1">
            <EditableField
              value={item.recap.summary}
              onCommit={(v) => { onUpdateField(item.id, "summary", v); }}
              placeholder="Summary..."
              multiline
            />
            <EditableBulletList
              bullets={item.recap.bullets}
              onCommit={(newBullets) => { onUpdateField(item.id, "bullets", newBullets); }}
            />
            <EditableField
              value={item.recap.bottomLine}
              onCommit={(v) => { onUpdateField(item.id, "bottomLine", v); }}
              placeholder="Bottom line..."
            />
          </div>
        ) : (
          <p className="mt-1 text-sm text-gray-600 line-clamp-2">
            {item.rationale}
          </p>
        )}
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
          className="flex h-11 w-11 items-center justify-center text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
    </article>
  );
}
