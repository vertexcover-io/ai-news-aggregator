import { useState } from "react";
import type { ReactElement } from "react";
import { Pencil, X, Plus } from "lucide-react";

interface EditableBulletListProps {
  bullets: string[];
  onCommit: (newBullets: string[]) => void;
}

export function EditableBulletList({
  bullets,
  onCommit,
}: EditableBulletListProps): ReactElement {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  function commitEdit(index: number): void {
    if (index === bullets.length) {
      if (draft.trim()) {
        onCommit([...bullets, draft]);
      }
    } else {
      const next = bullets.slice();
      next[index] = draft;
      onCommit(next);
    }
    setEditingIndex(null);
    setDraft("");
  }

  function cancelEdit(): void {
    setEditingIndex(null);
    setDraft("");
  }

  function startEdit(index: number, currentValue: string): void {
    setEditingIndex(index);
    setDraft(currentValue);
  }

  function deleteBullet(index: number): void {
    onCommit(bullets.filter((_, i) => i !== index));
  }

  return (
    <ul className="space-y-0.5 text-sm text-gray-600">
      {bullets.map((bullet, i) => (
        <li key={`${String(i)}-${bullet}`} className="flex items-center gap-1 group/bullet">
          {editingIndex === i ? (
            <>
              <span className="text-gray-400 shrink-0">•</span>
              <input
                autoFocus
                type="text"
                value={draft}
                onChange={(e) => { setDraft(e.target.value); }}
                onBlur={() => { commitEdit(i); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitEdit(i);
                  }
                  if (e.key === "Tab") {
                    e.preventDefault();
                    commitEdit(i);
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    cancelEdit();
                  }
                }}
                className="flex-1 border-b border-blue-400 focus:outline-none bg-transparent text-sm"
              />
            </>
          ) : (
            <>
              <span className="text-gray-400 shrink-0">•</span>
              <span
                className="flex-1 cursor-text"
                onClick={() => { startEdit(i, bullet); }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") { startEdit(i, bullet); }
                }}
              >
                {bullet}
              </span>
              <Pencil
                className="size-3 text-gray-300 group-hover/bullet:text-gray-500 shrink-0 cursor-pointer"
                aria-label={`Edit bullet ${String(i + 1)}`}
                onClick={() => { startEdit(i, bullet); }}
              />
              <button
                type="button"
                aria-label={`Delete bullet ${String(i + 1)}`}
                onClick={() => { deleteBullet(i); }}
                className="text-gray-300 hover:text-red-400 shrink-0"
              >
                <X className="size-3" />
              </button>
            </>
          )}
        </li>
      ))}
      {editingIndex === bullets.length ? (
        <li className="flex items-center gap-1">
          <span className="text-gray-400 shrink-0">•</span>
          <input
            autoFocus
            type="text"
            value={draft}
            onChange={(e) => { setDraft(e.target.value); }}
            onBlur={() => { commitEdit(bullets.length); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitEdit(bullets.length);
              }
              if (e.key === "Tab") {
                e.preventDefault();
                commitEdit(bullets.length);
              }
              if (e.key === "Escape") {
                e.preventDefault();
                cancelEdit();
              }
            }}
            className="flex-1 border-b border-blue-400 focus:outline-none bg-transparent text-sm"
            placeholder="New bullet..."
          />
        </li>
      ) : (
        <li>
          <button
            type="button"
            onClick={() => { startEdit(bullets.length, ""); }}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
          >
            <Plus className="size-3" />
            Add bullet
          </button>
        </li>
      )}
    </ul>
  );
}
