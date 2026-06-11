/**
 * Settings sources panel (P8, REQ-070/072/074): the normalized per-tenant
 * source rows — list with health + enable toggles, manual add (type select +
 * input), remove. Lives INSIDE Settings, never a standalone admin page
 * (REQ-074). Discovery pills arrive in P11.
 *
 * Until P9 flips collection onto enabled rows, the legacy collector cards
 * above still drive what the pipeline collects; this panel manages the
 * normalized library those runs will switch to.
 */
import { useState, type ReactElement } from "react";
import { Trash2 } from "lucide-react";
import type {
  ManualSourceType,
  SourceHealth,
  TenantSourceWire,
} from "@newsletter/shared/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useTenantSources } from "../../hooks/useTenantSources";

const TYPE_OPTIONS: { value: ManualSourceType; label: string }[] = [
  { value: "blog", label: "RSS / Blog" },
  { value: "reddit", label: "Reddit" },
  { value: "hn", label: "Hacker News" },
  { value: "github", label: "GitHub" },
  { value: "twitter", label: "X / Twitter" },
  { value: "web_search", label: "Web search" },
];

const TYPE_BADGES: Record<string, string> = {
  hn: "HN",
  reddit: "Reddit",
  twitter: "X",
  rss: "RSS",
  github: "GitHub",
  blog: "Blog",
  newsletter: "Newsletter",
  web_search: "Search",
};

function HealthBadge({ health }: { health: SourceHealth | null }): ReactElement {
  if (health === null) {
    return <Badge variant="outline">Unchecked</Badge>;
  }
  if (health.status === "ok") {
    return <Badge className="bg-emerald-100 text-emerald-800">Healthy</Badge>;
  }
  if (health.status === "warn") {
    return <Badge className="bg-amber-100 text-amber-800">{health.detail ?? "Slow"}</Badge>;
  }
  return <Badge className="bg-red-100 text-red-800">{health.detail ?? "Failing"}</Badge>;
}

function SourceRowItem({
  source,
  onToggle,
  onRemove,
  busy,
}: {
  source: TenantSourceWire;
  onToggle: (enabled: boolean) => void;
  onRemove: () => void;
  busy: boolean;
}): ReactElement {
  return (
    <div
      data-testid="source-row"
      className="flex items-center justify-between gap-3 rounded-md border bg-white px-3 py-2"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="truncate text-sm font-medium">{source.name}</span>
        <Badge variant="secondary">{TYPE_BADGES[source.type] ?? source.type}</Badge>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <HealthBadge health={source.health} />
        <Switch
          aria-label={`Toggle ${source.name}`}
          checked={source.enabled}
          disabled={busy}
          onCheckedChange={onToggle}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Remove ${source.name}`}
          disabled={busy}
          onClick={onRemove}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function TenantSourcesPanel(): ReactElement {
  const { query, add, toggle, remove } = useTenantSources();
  const [type, setType] = useState<ManualSourceType>("blog");
  const [value, setValue] = useState("");

  const sources = query.data ?? [];
  const activeCount = sources.filter((s) => s.enabled).length;
  const busy = add.isPending || toggle.isPending || remove.isPending;

  function handleAdd(): void {
    add.mutate(
      { type, value },
      {
        onSuccess: () => {
          setValue("");
        },
      },
    );
  }

  return (
    <Card data-testid="tenant-sources-panel">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>
              <h2 className="text-base font-semibold leading-none">Sources</h2>
            </CardTitle>
            <CardDescription>
              Where your pipeline collects from. Add your own, toggle any off.
            </CardDescription>
          </div>
          <Badge variant="outline">{activeCount} active</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <span className="text-sm font-medium">Add manually</span>
          <div className="flex gap-2">
            <select
              aria-label="Source type"
              className="h-9 rounded-md border bg-white px-2 text-sm"
              value={type}
              onChange={(e) => {
                setType(e.target.value as ManualSourceType);
              }}
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <Input
              aria-label="Source value"
              placeholder="https://example.com/feed.xml or r/… or @handle"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
              }}
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
              disabled={add.isPending}
              onClick={handleAdd}
            >
              Add
            </Button>
          </div>
        </div>

        <div className="space-y-1">
          <span className="text-sm font-medium">Your sources</span>
          {query.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading sources…</p>
          ) : sources.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No sources yet — add one above.
            </p>
          ) : (
            <div className="space-y-2">
              {sources.map((source) => (
                <SourceRowItem
                  key={source.id}
                  source={source}
                  busy={busy}
                  onToggle={(enabled) => {
                    toggle.mutate({ id: source.id, enabled });
                  }}
                  onRemove={() => {
                    remove.mutate(source.id);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
