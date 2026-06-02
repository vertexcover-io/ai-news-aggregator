import type { ReactElement } from "react";
import { Check, Play } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SaveBarProps {
  saving: boolean;
  runNowDisabled: boolean;
  onRunNow: () => void;
  lastSavedLabel?: string;
  // When the SaveBar lives outside the <form> element, set this to the
  // form's `id` so the submit button still triggers the form's onSubmit.
  formId?: string;
  onCheckAll?: () => void;
  checkAllDisabled?: boolean;
}

export function SaveBar({
  saving,
  runNowDisabled,
  onRunNow,
  lastSavedLabel,
  formId,
  onCheckAll,
  checkAllDisabled,
}: SaveBarProps): ReactElement {
  return (
    <div className="sticky bottom-0 -mx-4 flex items-center justify-between gap-4 border-t bg-white px-4 py-4 sm:-mx-6 sm:px-6 md:-mx-8 md:px-8">
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
          className="min-h-[44px] px-4"
        >
          <Play />
          Run now
        </Button>
        {onCheckAll !== undefined && (
          <Button
            type="button"
            variant="outline"
            onClick={onCheckAll}
            disabled={saving || checkAllDisabled === true}
            className="min-h-[44px] px-4"
          >
            Check All
          </Button>
        )}
        <Button
          type="submit"
          form={formId}
          disabled={saving}
          className="bg-black text-white hover:bg-black/90 min-h-[44px] px-4"
        >
          {saving ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
