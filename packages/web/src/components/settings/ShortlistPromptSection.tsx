import type { ReactElement } from "react";
import { useFormContext } from "react-hook-form";
import { DEFAULT_SHORTLIST_PROMPT } from "@newsletter/shared/constants";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { SettingsFormValues } from "../../pages/settingsSchema";

const MAX_LEN = 20000;
const WARN_LEN = 18000;

export function ShortlistPromptSection(): ReactElement {
  const form = useFormContext<SettingsFormValues>();
  const { register, setValue, watch, formState } = form;
  const value = watch("shortlistPrompt");
  const length = value.length;
  const error = formState.errors.shortlistPrompt;

  let countClass = "text-muted-foreground";
  if (length > MAX_LEN) countClass = "text-red-600";
  else if (length >= WARN_LEN) countClass = "text-amber-600";

  function handleReset(): void {
    setValue("shortlistPrompt", DEFAULT_SHORTLIST_PROMPT, {
      shouldDirty: true,
      shouldValidate: true,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Shortlist prompt</CardTitle>
        <CardDescription>
          System prompt sent to the LLM that selects the stage-1 shortlist from
          the collected candidate pool.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Label htmlFor="shortlistPrompt" className="sr-only">
          Shortlist prompt
        </Label>
        <textarea
          id="shortlistPrompt"
          rows={14}
          className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          {...register("shortlistPrompt")}
        />
        <div className="flex items-center justify-between">
          <span
            data-testid="shortlist-prompt-char-count"
            className={`text-xs tabular-nums ${countClass}`}
          >
            {length} / {MAX_LEN}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="shortlist-prompt-reset"
            onClick={handleReset}
          >
            Reset to default
          </Button>
        </div>
        {error?.message ? (
          <p
            role="alert"
            className="text-sm text-red-600"
            data-testid="shortlist-prompt-error"
          >
            {error.message}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
