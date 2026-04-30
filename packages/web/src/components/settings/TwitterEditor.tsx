import { Controller, type Control } from "react-hook-form";
import type { ReactElement } from "react";
import { Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { SettingsFormValues } from "../../pages/settingsSchema";

interface TwitterEditorProps {
  control: Control<SettingsFormValues>;
}

export function TwitterEditor({ control }: TwitterEditorProps): ReactElement {
  return (
    <div className="space-y-4">
      <p className="text-xs text-amber-700 font-medium">
        Requires TWITTER_COOKIES_JSON env var.
      </p>

      <div>
        <Label className="text-xs">Users (handles)</Label>
        <Controller
          control={control}
          name="twitterConfig.users"
          render={({ field }) => (
            <div className="mt-1 space-y-1">
              {field.value.map((user, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    aria-label={`Twitter user ${String(index + 1)}`}
                    placeholder="openai"
                    value={user}
                    onChange={(e) => {
                      const updated = field.value.map((u, i) =>
                        i === index ? e.target.value : u,
                      );
                      field.onChange(updated);
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove user ${String(index + 1)}`}
                    onClick={() => {
                      field.onChange(field.value.filter((_, i) => i !== index));
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  field.onChange([...field.value, ""]);
                }}
              >
                Add user
              </Button>
            </div>
          )}
        />
      </div>

      <div>
        <Label className="text-xs">Lists (URL or numeric ID)</Label>
        <Controller
          control={control}
          name="twitterConfig.listIds"
          render={({ field }) => (
            <div className="mt-1 space-y-1">
              {field.value.map((listId, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    aria-label={`Twitter list ${String(index + 1)}`}
                    placeholder="1234567890 or https://x.com/i/lists/1234567890"
                    value={listId}
                    onChange={(e) => {
                      const updated = field.value.map((l, i) =>
                        i === index ? e.target.value : l,
                      );
                      field.onChange(updated);
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove list ${String(index + 1)}`}
                    onClick={() => {
                      field.onChange(field.value.filter((_, i) => i !== index));
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  field.onChange([...field.value, ""]);
                }}
              >
                Add list
              </Button>
            </div>
          )}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="twitter-max" className="text-xs">
            Max per source
          </Label>
          <Controller
            control={control}
            name="twitterConfig.maxPerSource"
            render={({ field }) => (
              <Input
                id="twitter-max"
                type="number"
                className="mt-1"
                min={1}
                max={200}
                value={field.value}
                onChange={(e) => {
                  field.onChange(Number(e.target.value));
                }}
              />
            )}
          />
        </div>
        <div>
          <Label htmlFor="twitter-since" className="text-xs">
            Since (days)
          </Label>
          <Controller
            control={control}
            name="twitterConfig.sinceDays"
            render={({ field }) => (
              <Input
                id="twitter-since"
                type="number"
                className="mt-1"
                min={1}
                max={30}
                value={field.value}
                onChange={(e) => {
                  field.onChange(Number(e.target.value));
                }}
              />
            )}
          />
        </div>
      </div>
    </div>
  );
}
