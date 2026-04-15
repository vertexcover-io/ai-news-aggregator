import type { ReactElement } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
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
}

export function ReviewList({
  items,
  addedIds,
  onReorder,
  onDelete,
  onUpdateField,
  pendingCount,
}: ReviewListProps): ReactElement {
  const sensors = useSensors(
    useSensor(PointerSensor),
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
        </ul>
      </SortableContext>
    </DndContext>
  );
}
