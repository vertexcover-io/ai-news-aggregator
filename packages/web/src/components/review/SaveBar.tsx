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
}

export function SaveBar({
  unsavedCount,
  saving,
  canSave,
  onSave,
  onDiscard,
}: SaveBarProps): ReactElement {
  const [confirmOpen, setConfirmOpen] = useState(false);

  function handleConfirmDiscard(): void {
    setConfirmOpen(false);
    onDiscard();
  }

  return (
    <div className="sticky bottom-0 left-0 right-0 flex items-center justify-between gap-4 border-t bg-white px-8 py-4 shadow-lg">
      <div className="text-sm text-muted-foreground">
        {unsavedCount} unsaved {unsavedCount === 1 ? "change" : "changes"}
      </div>
      <div className="flex items-center gap-2">
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogTrigger asChild>
            <Button type="button" variant="outline" disabled={saving}>
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
        <Button
          type="button"
          onClick={onSave}
          disabled={!canSave || saving}
          aria-disabled={!canSave || saving}
          className="bg-black text-white hover:bg-black/90"
        >
          {saving ? "Saving..." : "Save & view archive"}
          <ArrowRight />
        </Button>
      </div>
    </div>
  );
}
