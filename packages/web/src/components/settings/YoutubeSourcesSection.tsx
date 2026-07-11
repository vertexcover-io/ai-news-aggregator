import { useState, type ReactElement } from "react";
import { Trash2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTenantSources } from "../../hooks/useTenantSources";

/**
 * YouTube channels are rows-only (P8 `sources` table) — unlike the other
 * five collectors above, there is no legacy `user_settings` JSONB column for
 * this type, so it can't live inside the react-hook-form `SourcesSection`
 * card (that form round-trips through the JSONB bridge on save). This panel
 * talks straight to `/api/sources` via `useTenantSources`, mirroring the
 * onboarding wizard's "Add manually" flow — adds/removes/toggles take effect
 * immediately, no Save button.
 */
export function YoutubeSourcesSection(): ReactElement {
  const { query, add, toggle, remove } = useTenantSources();
  const [channelRef, setChannelRef] = useState("");

  const channels = (query.data ?? []).filter((s) => s.type === "youtube");

  function handleAdd(): void {
    const value = channelRef.trim();
    if (value.length === 0) return;
    add.mutate(
      { type: "youtube", value },
      { onSuccess: () => { setChannelRef(""); } },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>YouTube</CardTitle>
        <CardDescription>
          Channels are polled via their public RSS feed; new videos are
          transcribed and go through the same ranking/relevance pipeline as
          every other source before appearing in the digest.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {channels.map((source) => (
          <div
            key={source.id}
            className="flex items-center justify-between gap-3 rounded-md border bg-white px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <Switch
                aria-label={source.name}
                checked={source.enabled}
                onCheckedChange={(checked) => {
                  toggle.mutate({ id: source.id, enabled: checked });
                }}
              />
              <span className="font-medium">{source.name}</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                remove.mutate(source.id);
              }}
              aria-label={`Remove ${source.name}`}
              className="min-h-[44px] min-w-[44px]"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <div className="flex gap-2">
          <Input
            aria-label="Channel ID, @handle, or channel URL"
            placeholder="@lexfridman or https://youtube.com/channel/UC…"
            value={channelRef}
            onChange={(e) => { setChannelRef(e.target.value); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAdd();
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={channelRef.trim().length === 0 || add.isPending}
            onClick={handleAdd}
          >
            Add channel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
