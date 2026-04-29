import type { ReactElement } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { RankedItem } from "@newsletter/shared";
import type { PendingPromote } from "../../hooks/useReview";
import { ReviewCard } from "./ReviewCard";

interface ReviewListProps {
  items: RankedItem[];
  addedIds: Set<number>;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onDelete: (id: number) => void;
  onUpdateField: (
    id: number,
    field: "summary" | "bullets" | "bottomLine" | "imageUrl",
    value: string | string[] | null,
  ) => void;
  pendingCount: number;
  pendingPromotes: PendingPromote[];
  failedPromotes: Map<string, { rawItemId: number; title: string }>;
  onRetryPromote: (tempId: string, rawItemId: number, title: string) => void;
}

export function ReviewList({
  items,
  addedIds,
  onReorder,
  onDelete,
  onUpdateField,
  pendingCount,
  pendingPromotes,
  failedPromotes,
  onRetryPromote,
}: ReviewListProps): ReactElement {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragEnd(event: DragEndEvent): void {
    const { active, over } = event;
    if (!over) return;
    if (active.id === over.id) return;
    const fromIndex = items.findIndex((it) => it.id === active.id);
    const toIndex = items.findIndex((it) => it.id === over.id);
    if (fromIndex < 0 || toIndex < 0) return;
    onReorder(fromIndex, toIndex);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={items.map((it) => it.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className="space-y-3 list-none p-0">
          {items.map((item, index) => (
            <li key={item.id}>
              <ReviewCard
                item={item}
                rank={index + 1}
                isAdded={addedIds.has(item.id)}
                onDelete={onDelete}
                onUpdateField={onUpdateField}
              />
            </li>
          ))}
          {Array.from({ length: pendingCount }).map((_, i) => (
            <li
              key={`pending-${String(i)}`}
              data-pending="true"
              className="rounded-lg border border-dashed bg-gray-50 px-4 py-6 text-sm text-muted-foreground"
            >
              Fetching post...
            </li>
          ))}
          {pendingPromotes.map((p) => (
            <li
              key={p.tempId}
              data-pending-promote="true"
              className="rounded-lg border-2 border-dashed border-blue-300 bg-blue-50 px-4 py-6 text-sm"
            >
              <p className="font-medium text-gray-900">{p.title}</p>
              <p className="text-muted-foreground mt-1">
                Processing — generating recap...
              </p>
            </li>
          ))}
          {Array.from(failedPromotes.entries()).map(
            ([tempId, { rawItemId, title }]) => (
              <li
                key={tempId}
                data-failed-promote="true"
                className="rounded-lg border-2 border-dashed border-red-300 bg-red-50 px-4 py-6 text-sm"
              >
                <p className="font-medium text-gray-900">{title}</p>
                <p className="text-red-600 mt-1">Recap generation failed</p>
                <button
                  type="button"
                  onClick={() => {
                    onRetryPromote(tempId, rawItemId, title);
                  }}
                  className="mt-2 rounded-md bg-red-100 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-200 transition-colors"
                >
                  Retry
                </button>
              </li>
            ),
          )}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
