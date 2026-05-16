import type { ReactElement } from "react";
import {
  useWatch,
  type Control,
  type UseFormRegister,
  type UseFormSetValue,
} from "react-hook-form";
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

const MAX = 8000;

interface RankingSectionProps {
  register: UseFormRegister<SettingsFormValues>;
  control: Control<SettingsFormValues>;
  setValue: UseFormSetValue<SettingsFormValues>;
}

export function RankingSection({
  register,
  control,
  setValue,
}: RankingSectionProps): ReactElement {
  const value = useWatch({ control, name: "rankingWorkflow" });
  const count = value.length;
  const overLimit = count > MAX;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ranking</CardTitle>
        <CardDescription>
          How should stories be ranked? Write in plain English. This text is
          the workflow part of the LLM prompt; it&rsquo;s appended to the
          structural contract every run. Leave empty to use the default
          editorial workflow.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2">
          <Label htmlFor="rankingWorkflow">Editorial workflow</Label>
          <textarea
            id="rankingWorkflow"
            rows={12}
            className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            placeholder="e.g. Boost primary-source agent releases. Downrank funding-only stories. In the top 3 prefer agent-ops over benchmark posts."
            {...register("rankingWorkflow")}
          />
          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setValue("rankingWorkflow", "", {
                  shouldDirty: true,
                  shouldTouch: true,
                });
              }}
            >
              Reset to default
            </Button>
            <span
              data-testid="ranking-workflow-counter"
              className={`text-sm ${overLimit ? "text-destructive" : "text-muted-foreground"}`}
            >
              {count} / {MAX}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
