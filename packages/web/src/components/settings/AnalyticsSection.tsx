import type { ReactElement } from "react";
import { Controller, type Control, type UseFormRegister } from "react-hook-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SettingsFormValues } from "../../pages/settingsSchema";

interface AnalyticsSectionProps {
  register: UseFormRegister<SettingsFormValues>;
  control: Control<SettingsFormValues>;
}

export function AnalyticsSection({
  register,
  control,
}: AnalyticsSectionProps): ReactElement {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Analytics</CardTitle>
          <CardDescription>
            Configure PostHog page analytics and API event capture.
          </CardDescription>
        </div>
        <Controller
          control={control}
          name="posthogEnabled"
          render={({ field }) => (
            <Switch
              aria-label="Enable PostHog analytics"
              checked={field.value}
              onCheckedChange={(value) => {
                field.onChange(value);
              }}
            />
          )}
        />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-1.5">
          <Label htmlFor="posthogProjectToken">Project token</Label>
          <Input
            id="posthogProjectToken"
            placeholder="phc_..."
            autoComplete="off"
            {...register("posthogProjectToken")}
          />
          <p className="text-sm text-muted-foreground">
            This is the public PostHog project token used for event ingestion,
            not a private personal API key.
          </p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="posthogHost">Host</Label>
          <Input
            id="posthogHost"
            placeholder="https://us.i.posthog.com"
            {...register("posthogHost")}
          />
        </div>
      </CardContent>
    </Card>
  );
}

