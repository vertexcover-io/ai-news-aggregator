import type { ReactElement } from "react";
import { useFormContext } from "react-hook-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SettingsFormValues } from "../../pages/settingsSchema";

export function ShortlistSizeField(): ReactElement {
  const form = useFormContext<SettingsFormValues>();
  const { register, formState, watch } = form;
  // Subscribe to value changes so formState.errors re-renders on validation.
  watch("shortlistSize");
  const error = formState.errors.shortlistSize;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Shortlist size</CardTitle>
        <CardDescription>
          Number of candidates the stage-1 LLM shortlister selects from the
          full collected pool before reranking. Must be between 5 and 100.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Label htmlFor="shortlistSize">Shortlist size</Label>
        <Input
          id="shortlistSize"
          type="number"
          inputMode="numeric"
          min={5}
          max={100}
          step={1}
          className="max-w-[160px]"
          {...register("shortlistSize", { valueAsNumber: true })}
        />
        {error?.message ? (
          <p
            role="alert"
            className="text-sm text-red-600"
            data-testid="shortlist-size-error"
          >
            {error.message}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
