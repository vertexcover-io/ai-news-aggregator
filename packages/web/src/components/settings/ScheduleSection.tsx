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
      return intl.supportedValuesOf("timeZone");
    } catch {
      return FALLBACK_TIMEZONES;
    }
  }
  return FALLBACK_TIMEZONES;
}

interface ScheduleSectionProps {
  register: UseFormRegister<SettingsFormValues>;
  control: Control<SettingsFormValues>;
}

export function ScheduleSection({
  register,
  control,
}: ScheduleSectionProps): ReactElement {
  const timezones = getTimezones();
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Schedule</CardTitle>
          <CardDescription>
            Runs automatically every day at the time you pick.
          </CardDescription>
        </div>
        <Controller
          control={control}
          name="scheduleEnabled"
          render={({ field }) => (
            <Switch
              aria-label="Enable schedule"
              checked={field.value}
              onCheckedChange={(v) => { field.onChange(v); }}
            />
          )}
        />
      </CardHeader>
      <CardContent>
        <fieldset className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <legend className="sr-only">Schedule</legend>
          <div className="grid gap-1.5">
            <Label htmlFor="scheduleTime">Time</Label>
            <Input id="scheduleTime" type="time" {...register("scheduleTime")} />
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
                  <SelectTrigger id="scheduleTimezone">
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
        </fieldset>
      </CardContent>
    </Card>
  );
}
