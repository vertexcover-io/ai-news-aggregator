import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export type DiffLine =
  | { type: "same"; text: string }
  | { type: "add"; text: string }
  | { type: "remove"; text: string };

export function diffLines(current: string, draft: string): DiffLine[] {
  const a = current.split("\n");
  const b = draft.split("\n");
  // Naive LCS-based line diff (small inputs: prompts ≤20k chars).
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "remove", text: a[i] });
      i++;
    } else {
      out.push({ type: "add", text: b[j] });
      j++;
    }
  }
  while (i < m) {
    out.push({ type: "remove", text: a[i] });
    i++;
  }
  while (j < n) {
    out.push({ type: "add", text: b[j] });
    j++;
  }
  return out;
}

export interface PromptDiffModalProps {
  current: string;
  draft: string;
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  saving?: boolean;
}

export function PromptDiffModal({
  current,
  draft,
  open,
  onConfirm,
  onCancel,
  saving = false,
}: PromptDiffModalProps): ReactElement {
  const lines = diffLines(current, draft);
  const addCount = lines.filter((l) => l.type === "add").length;
  const removeCount = lines.filter((l) => l.type === "remove").length;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Save as current prompt?</DialogTitle>
          <DialogDescription>
            This replaces the saved ranking prompt. Diff:{" "}
            <span className="text-emerald-700">+{addCount}</span>{" "}
            <span className="text-rose-700">-{removeCount}</span>
          </DialogDescription>
        </DialogHeader>
        <pre
          data-testid="prompt-diff-body"
          className="max-h-[60vh] overflow-auto rounded bg-neutral-950 p-3 font-mono text-xs leading-relaxed text-neutral-100"
        >
          {lines.map((l, idx) => {
            const prefix =
              l.type === "add" ? "+ " : l.type === "remove" ? "- " : "  ";
            const cls =
              l.type === "add"
                ? "bg-emerald-900/40 text-emerald-200"
                : l.type === "remove"
                  ? "bg-rose-900/40 text-rose-200"
                  : "text-neutral-400";
            return (
              <div
                key={idx}
                data-difftype={l.type}
                className={cls}
              >
                {prefix}
                {l.text}
              </div>
            );
          })}
        </pre>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
