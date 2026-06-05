import { useState, type ReactElement } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface SaveBarProps {
  unsavedCount: number;
  saving: boolean;
  canSave: boolean;
  onSave: () => void;
  onDiscard: () => void;
  disabledReason?: string | null;
  /** Non-blocking amber warning shown alongside the unsaved count. Never disables Save. */
  warning?: string | null;
}

export function SaveBar({
  unsavedCount,
  saving,
  canSave,
  onSave,
  onDiscard,
  disabledReason = null,
  warning = null,
}: SaveBarProps): ReactElement {
  const [confirmOpen, setConfirmOpen] = useState(false);

  function handleConfirmDiscard(): void {
    setConfirmOpen(false);
    onDiscard();
  }

  return (
    <div className="sticky bottom-0 left-0 right-0 flex items-center justify-between gap-4 border-t bg-white px-8 py-4 shadow-lg">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm text-muted-foreground">
          {unsavedCount} unsaved {unsavedCount === 1 ? "change" : "changes"}
        </span>
        {warning !== null ? (
          <span
            data-testid="save-warning"
            className="text-xs text-amber-700"
          >
            {warning}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogTrigger asChild>
            <Button type="button" variant="outline" disabled={saving} className="min-h-[44px] px-4">
              Discard
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Discard all changes?</DialogTitle>
              <DialogDescription>
                Your reordering, deletions, and added posts will be lost.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setConfirmOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleConfirmDiscard}
                className="bg-red-600 text-white hover:bg-red-700"
              >
                Discard
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <span className="relative group inline-block">
          <Button
            type="button"
            onClick={onSave}
            disabled={!canSave || saving}
            aria-disabled={!canSave || saving}
            title={disabledReason ?? undefined}
            className="bg-black text-white hover:bg-black/90 min-h-[44px] px-4"
          >
            {saving ? "Saving..." : "Save & view archive"}
            <ArrowRight />
          </Button>
          {disabledReason !== null && !canSave && !saving ? (
            <span
              role="tooltip"
              data-testid="save-disabled-tooltip"
              className="pointer-events-none absolute bottom-full right-0 mb-2 hidden whitespace-nowrap rounded-md bg-gray-900 px-3 py-1.5 text-xs text-white shadow-md group-hover:block group-focus-within:block"
            >
              {disabledReason}
            </span>
          ) : null}
        </span>
      </div>
    </div>
  );
}
