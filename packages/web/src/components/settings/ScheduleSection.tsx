import type { ReactElement } from "react";
import { Controller, type Control, type FieldErrors, type UseFormRegister } from "react-hook-form";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SettingsFormValues } from "../../pages/settingsSchema";

const FALLBACK_TIMEZONES = [
  "UTC",
  "America/New_York",
  "Europe/London",
  "Asia/Kolkata",
  "Asia/Tokyo",
  "Australia/Sydney",
];

function getTimezones(): string[] {
  const intl = Intl as typeof Intl & {
    supportedValuesOf?: (key: string) => string[];
  };
  if (typeof intl.supportedValuesOf === "function") {
    try {
      const supported = intl.supportedValuesOf("timeZone");
      // `Intl.supportedValuesOf("timeZone")` returns only canonical IANA names
      // (e.g. "Etc/UTC", "Atlantic/Reykjavik") and excludes the alias "UTC".
      // The persisted DB value uses "UTC" though — and Radix Select clears
      // its controlled value to "" if the value isn't in the option list,
      // which silently fails the schema's `z.string().min(1)` check.
      // Include "UTC" so the persisted alias remains a selectable option.
      // Discovered debugging Stage-5 VS-6.
      return supported.includes("UTC") ? supported : ["UTC", ...supported];
    } catch {
      return FALLBACK_TIMEZONES;
    }
  }
  return FALLBACK_TIMEZONES;
}

interface ScheduleSectionProps {
  register: UseFormRegister<SettingsFormValues>;
  control: Control<SettingsFormValues>;
  errors?: FieldErrors<SettingsFormValues>;
}

export function ScheduleSection({
  register,
  control,
  errors = {},
}: ScheduleSectionProps): ReactElement {
  const timezones = getTimezones();
  const rows = [
    { name: "pipelineTime", label: "Pipeline" },
    { name: "emailTime", label: "Email", enabledName: "emailEnabled" },
    { name: "linkedinTime", label: "LinkedIn", enabledName: "linkedinEnabled" },
    { name: "twitterTime", label: "Twitter", enabledName: "twitterPostEnabled" },
  ] as const;
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Schedule</CardTitle>
          <CardDescription>
            Runs and publishes automatically; publish times earlier than the pipeline run on the next day.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <fieldset className="grid grid-cols-1 gap-4">
          <legend className="sr-only">Schedule</legend>
          <div className="flex flex-wrap gap-6">
            <Controller
              control={control}
              name="scheduleEnabled"
              render={({ field }) => (
                <label className="inline-flex min-h-[44px] items-center gap-2 text-sm font-medium">
                  <Switch
                    aria-label="Enable schedule"
                    checked={field.value}
                    onCheckedChange={(v) => { field.onChange(v); }}
                  />
                  Enable schedule
                </label>
              )}
            />
            <Controller
              control={control}
              name="autoReview"
              render={({ field }) => (
                <label className="inline-flex min-h-[44px] items-center gap-2 text-sm font-medium">
                  <Switch
                    aria-label="Auto-review"
                    checked={field.value}
                    onCheckedChange={(v) => { field.onChange(v); }}
                  />
                  Auto-review
                </label>
              )}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="scheduleTimezone">Timezone</Label>
            <Controller
              control={control}
              name="scheduleTimezone"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={(v) => { field.onChange(v); }}
                >
                  <SelectTrigger id="scheduleTimezone" className="min-h-[44px] w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {timezones.map((tz) => (
                      <SelectItem key={tz} value={tz}>
                        {tz}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div className="grid gap-3">
            {rows.map((row) => (
              <div
                key={row.name}
                className="grid items-start gap-2 rounded-md border border-border p-3 md:grid-cols-[140px_1fr_110px]"
              >
                <Label htmlFor={row.name} className="pt-3">
                  {row.label}
                </Label>
                <div className="grid gap-1">
                  <Input id={row.name} type="time" {...register(row.name)} />
                  {errors[row.name]?.message ? (
                    <p className="text-sm text-destructive">
                      {String(errors[row.name]?.message)}
                    </p>
                  ) : null}
                </div>
                {"enabledName" in row ? (
                  <Controller
                    control={control}
                    name={row.enabledName}
                    render={({ field }) => (
                      <label className="inline-flex min-h-[44px] items-center gap-2 text-sm">
                        <Switch
                          aria-label={`${row.label} enabled`}
                          checked={field.value}
                          onCheckedChange={(v) => { field.onChange(v); }}
                        />
                        Enabled
                      </label>
                    )}
                  />
                ) : null}
              </div>
            ))}
          </div>
        </fieldset>
      </CardContent>
    </Card>
  );
}
