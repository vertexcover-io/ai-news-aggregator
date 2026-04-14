import type { ReactElement } from "react";
import {
  type Control,
  type UseFormRegister,
  Controller,
} from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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

interface ProfileSectionProps {
  register: UseFormRegister<SettingsFormValues>;
  control: Control<SettingsFormValues>;
  profiles: string[];
}

export function ProfileSection({
  register,
  control,
  profiles,
}: ProfileSectionProps): ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile &amp; ranking</CardTitle>
        <CardDescription>
          Pick the profile used for ranking and how many posts end up in the digest.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <fieldset className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <legend className="sr-only">Profile and ranking</legend>
          <div className="grid gap-1.5">
            <Label htmlFor="profileName">Profile</Label>
            <Controller
              control={control}
              name="profileName"
              render={({ field }) => (
                <Select
                  value={field.value ?? ""}
                  onValueChange={(v) => { field.onChange(v); }}
                >
                  <SelectTrigger id="profileName">
                    <SelectValue placeholder="Select a profile" />
                  </SelectTrigger>
                  <SelectContent>
                    {profiles.map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="topN">Top N posts</Label>
            <Input
              id="topN"
              type="number"
              {...register("topN", { valueAsNumber: true })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="halfLifeHours">Half-life (hours)</Label>
            <Input
              id="halfLifeHours"
              type="number"
              {...register("halfLifeHours", {
                setValueAs: (v: string) => (v === "" ? null : Number(v)),
              })}
            />
          </div>
        </fieldset>
      </CardContent>
    </Card>
  );
}
