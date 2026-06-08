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
  /**
   * When non-null, clicking Save opens a confirm dialog showing this message;
   * onSave only fires after the user confirms with "Save anyway".
   */
  saveConfirmation?: string | null;
  /**
   * When provided, renders a secondary "Save draft" button to the left of the
   * primary button. The primary label becomes "Save & publish" instead of
   * "Save & view archive".
   */
  onSaveDraft?: () => void;
  /** True while the draft save is in flight — disables the Save draft button. */
  draftSaving?: boolean;
}

export function SaveBar({
  unsavedCount,
  saving,
  canSave,
  onSave,
  onDiscard,
  disabledReason = null,
  warning = null,
  saveConfirmation = null,
  onSaveDraft,
  draftSaving = false,
}: SaveBarProps): ReactElement {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false);
  // Which action opened the "Save without regenerating?" dialog, so confirming
  // routes to the matching callback (draft vs publish).
  const [pendingAction, setPendingAction] = useState<"publish" | "draft">(
    "publish",
  );

  function handleConfirmDiscard(): void {
    setConfirmOpen(false);
    onDiscard();
  }

  function handleSaveClick(): void {
    if (saveConfirmation !== null) {
      setPendingAction("publish");
      setConfirmSaveOpen(true);
      return;
    }
    onSave();
  }

  function handleSaveDraftClick(): void {
    if (saveConfirmation !== null) {
      setPendingAction("draft");
      setConfirmSaveOpen(true);
      return;
    }
    onSaveDraft?.();
  }

  function handleConfirmSave(): void {
    setConfirmSaveOpen(false);
    if (pendingAction === "draft") {
      onSaveDraft?.();
    } else {
      onSave();
    }
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
        {onSaveDraft !== undefined ? (
          <Button
            type="button"
            variant="outline"
            onClick={handleSaveDraftClick}
            disabled={!canSave || draftSaving || saving}
            aria-disabled={!canSave || draftSaving || saving}
            className="min-h-[44px] px-4"
          >
            {draftSaving ? "Saving..." : "Save draft"}
          </Button>
        ) : null}
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
        <Dialog open={confirmSaveOpen} onOpenChange={setConfirmSaveOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Save without regenerating?</DialogTitle>
              <DialogDescription data-testid="save-confirmation-message">
                {saveConfirmation}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setConfirmSaveOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleConfirmSave}
                className="bg-black text-white hover:bg-black/90"
              >
                Save anyway
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <span className="relative group inline-block">
          <Button
            type="button"
            onClick={handleSaveClick}
            disabled={!canSave || saving}
            aria-disabled={!canSave || saving}
            title={disabledReason ?? undefined}
            className="bg-black text-white hover:bg-black/90 min-h-[44px] px-4"
          >
            {saving ? "Saving..." : onSaveDraft !== undefined ? "Save & publish" : "Save & view archive"}
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
