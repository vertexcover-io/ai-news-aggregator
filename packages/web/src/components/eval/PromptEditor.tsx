import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";

export interface PromptEditorProps {
  value: string;
  savedValue: string;
  onChange: (s: string) => void;
  onReset: () => void;
  onSave: () => void;
}

export function PromptEditor({
  value,
  savedValue,
  onChange,
  onReset,
  onSave,
}: PromptEditorProps): ReactElement {
  const dirty = value !== savedValue;
  return (
    <div className="flex h-full flex-col gap-2">
      <label className="font-mono text-xs uppercase tracking-widest text-neutral-500">
        Ranking prompt (draft)
      </label>
      <textarea
        data-testid="prompt-editor-textarea"
        aria-label="Ranking prompt"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        className="min-h-[420px] flex-1 w-full resize-vertical rounded border border-neutral-300 bg-white p-3 font-mono text-xs leading-relaxed focus:border-neutral-500 focus:outline-none"
        spellCheck={false}
      />
      <div className="flex items-center justify-between border-t pt-2">
        <span className="font-mono text-xs text-neutral-500">
          {value.length.toLocaleString()} chars
          {dirty ? " · unsaved" : " · saved"}
        </span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!dirty}
            onClick={onReset}
          >
            Reset to saved
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!dirty}
            onClick={onSave}
          >
            Save as current prompt
          </Button>
        </div>
      </div>
    </div>
  );
}
