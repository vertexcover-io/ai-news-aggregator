import type { ReactElement } from "react";
import { Check, Play } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SaveBarProps {
  saving: boolean;
  runNowDisabled: boolean;
  onRunNow: () => void;
  lastSavedLabel?: string;
}

export function SaveBar({
  saving,
  runNowDisabled,
  onRunNow,
  lastSavedLabel,
}: SaveBarProps): ReactElement {
  return (
    <div className="sticky bottom-0 -mx-8 flex items-center justify-between gap-4 border-t bg-white px-8 py-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {lastSavedLabel !== undefined && (
          <>
            <Check className="size-4 text-emerald-600" />
            <span>{lastSavedLabel}</span>
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onRunNow}
          disabled={runNowDisabled}
        >
          <Play />
          Run now
        </Button>
        <Button
          type="submit"
          disabled={saving}
          className="bg-black text-white hover:bg-black/90"
        >
          {saving ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
