import { type ReactElement } from "react";
import { Controller, useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StepShell } from "./StepShell";
import type { WizardData } from "./types";

interface ScheduleStepProps {
  onBack: () => void;
}

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
      return supported.includes("UTC") ? supported : ["UTC", ...supported];
    } catch {
      return FALLBACK_TIMEZONES;
    }
  }
  return FALLBACK_TIMEZONES;
}

export function ScheduleStep({ onBack }: ScheduleStepProps): ReactElement {
  const { register, control } = useFormContext<WizardData>();
  const timezones = getTimezones();
  return (
    <StepShell
      stepNumber={8}
      title="Set your schedule"
      blurb="When the pipeline runs and when the digest sends. We jitter start times slightly to spread load."
      onBack={onBack}
    >
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="ob-pipeline">Pipeline run</Label>
          <Input id="ob-pipeline" type="time" {...register("pipelineTime")} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ob-emailtime">Email send</Label>
          <Input id="ob-emailtime" type="time" {...register("emailTime")} />
        </div>
      </div>
      <div className="mt-4 grid gap-1.5">
        <Label htmlFor="ob-tz">Timezone</Label>
        <Controller
          control={control}
          name="scheduleTimezone"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="ob-tz" className="w-full">
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
    </StepShell>
  );
}
