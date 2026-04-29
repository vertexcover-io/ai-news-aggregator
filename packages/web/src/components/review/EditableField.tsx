import { useState, useEffect } from "react";
import type { ReactElement } from "react";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

interface EditableFieldProps {
  value: string;
  onCommit: (newValue: string) => void;
  placeholder?: string;
  multiline?: boolean;
  className?: string;
}

export function EditableField({
  value,
  onCommit,
  placeholder,
  multiline,
  className,
}: EditableFieldProps): ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  function commit(): void {
    setEditing(false);
    onCommit(draft);
  }

  function cancel(): void {
    setDraft(value);
    setEditing(false);
  }

  if (editing) {
    const commonProps = {
      autoFocus: true,
      value: draft,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setDraft(e.target.value);
      },
      onBlur: commit,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !multiline) {
          e.preventDefault();
          commit();
        }
        if (e.key === "Tab") {
          e.preventDefault();
          commit();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
      },
      className:
        "w-full text-sm border-b border-blue-400 focus:outline-none bg-transparent resize-none",
    };
    return multiline ? (
      <textarea {...commonProps} rows={2} />
    ) : (
      <input type="text" {...commonProps} />
    );
  }

  return (
    <div
      className={cn("group relative flex items-start gap-1 cursor-text min-h-[44px]", className)}
      onClick={() => { setEditing(true); }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { setEditing(true); }
      }}
    >
      <span className="text-sm text-gray-600 flex-1 min-w-0">
        {value || (
          <span className="text-gray-300 italic">{placeholder}</span>
        )}
      </span>
      <Pencil
        className="size-3 text-gray-300 group-hover:text-gray-500 shrink-0 mt-0.5"
        aria-label="Edit"
      />
    </div>
  );
}
