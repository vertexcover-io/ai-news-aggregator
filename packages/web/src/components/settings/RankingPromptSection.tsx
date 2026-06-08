import type { ReactElement } from "react";
import { useFormContext } from "react-hook-form";
import { DEFAULT_RANKING_PROMPT } from "@newsletter/shared/constants";
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

export function RankingPromptSection(): ReactElement {
  const form = useFormContext<SettingsFormValues>();
  const { register, setValue, watch, formState } = form;
  const value = watch("rankingPrompt");
  const length = value.length;
  const error = formState.errors.rankingPrompt;

  let countClass = "text-muted-foreground";
  if (length > MAX_LEN) countClass = "text-red-600";
  else if (length >= WARN_LEN) countClass = "text-amber-600";

  function handleReset(): void {
    setValue("rankingPrompt", DEFAULT_RANKING_PROMPT, {
      shouldDirty: true,
      shouldValidate: true,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ranking prompt</CardTitle>
        <CardDescription>
          System prompt sent to the LLM during the rerank stage.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Label htmlFor="rankingPrompt" className="sr-only">
          Ranking prompt
        </Label>
        <textarea
          id="rankingPrompt"
          rows={14}
          className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          {...register("rankingPrompt")}
        />
        <div className="flex items-center justify-between">
          <span
            data-testid="ranking-prompt-char-count"
            className={`text-xs tabular-nums ${countClass}`}
          >
            {length} / {MAX_LEN}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="ranking-prompt-reset"
            onClick={handleReset}
          >
            Reset to default
          </Button>
        </div>
        {error?.message ? (
          <p
            role="alert"
            className="text-sm text-red-600"
            data-testid="ranking-prompt-error"
          >
            {error.message}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
