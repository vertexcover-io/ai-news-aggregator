import { useState } from "react";
import type { ReactElement } from "react";
import {
  useAdminSources,
  useCreateAdminSource,
  usePatchAdminSource,
  useDeleteAdminSource,
} from "../../hooks/useAdminSources";
import type { AdminSource } from "../../api/sources-admin";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus } from "lucide-react";

const SOURCE_TYPE_LABELS: Record<string, string> = {
  hn: "Hacker News",
  reddit: "Reddit",
  twitter: "Twitter / X",
  rss: "RSS Feed",
  github: "GitHub",
  blog: "Blog / Website",
  newsletter: "Newsletter",
  web_search: "Web Search",
};

const SOURCE_TYPES = Object.keys(SOURCE_TYPE_LABELS);

function sourceLabel(type: string): string {
  return SOURCE_TYPE_LABELS[type] ?? type;
}

function sourceSummary(source: AdminSource): string {
  if (!source.config) return "No config";
  if (source.type === "hn") {
    const c = source.config as { keywords?: string[]; sinceDays?: number };
    return [c.keywords?.join(", "), c.sinceDays !== undefined ? `last ${String(c.sinceDays)}d` : null]
      .filter(Boolean)
      .join(" · ") || "Configured";
  }
  if (source.type === "reddit") {
    const c = source.config as { subreddits?: string[] };
    return c.subreddits?.join(", ") ?? "Configured";
  }
  if (source.type === "web_search") {
    const c = source.config as { queries?: { query: string }[] };
    return `${String(c.queries?.length ?? 0)} queries`;
  }
  if (source.type === "blog") {
    const c = source.config as { sources?: { name: string }[] };
    return c.sources?.map((s) => s.name).join(", ") ?? "Configured";
  }
  if (source.type === "twitter") {
    const c = source.config as { listIds?: string[]; users?: { handle: string }[] };
    const lists = c.listIds?.length ?? 0;
    const users = c.users?.length ?? 0;
    return [`${String(lists)} lists`, `${String(users)} users`].join(" · ") || "Configured";
  }
  return "Configured";
}

function healthBadge(source: AdminSource): ReactElement | null {
  if (!source.lastHealth) return null;
  const h = source.lastHealth;
  let variant: "default" | "secondary" | "destructive" = "secondary";
  let label = "unknown";
  if (h.status === "healthy") {
    variant = "default";
    label = "Healthy";
  } else if (h.status === "degraded") {
    variant = "secondary";
    label = "Degraded";
  } else if (h.status === "failed") {
    variant = "destructive";
    label = "Failed";
  }
  return <Badge variant={variant}>{label}</Badge>;
}

export function SourcesPanel(): ReactElement {
  const { data: sources, isLoading } = useAdminSources();
  const createMutation = useCreateAdminSource();
  const patchMutation = usePatchAdminSource();
  const deleteMutation = useDeleteAdminSource();

  const [showAddForm, setShowAddForm] = useState(false);
  const [newType, setNewType] = useState("hn");

  function handleToggle(source: AdminSource, enabled: boolean): void {
    patchMutation.mutate({ id: source.id, input: { enabled } });
  }

  function handleDelete(source: AdminSource): void {
    deleteMutation.mutate(source.id);
  }

  function handleAdd(): void {
    createMutation.mutate({ type: newType, enabled: true });
    setShowAddForm(false);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Sources</CardTitle>
            <CardDescription>
              Manage per-tenant collection sources. Enabled sources are collected on each run.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => { setShowAddForm((v) => !v); }}
            aria-label="Add source"
            data-testid="sources-add-button"
            className="shrink-0"
          >
            <Plus className="h-4 w-4 mr-1" />
            Add source
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {showAddForm && (
          <div className="flex items-end gap-2 rounded-md border bg-muted/30 p-3">
            <div className="flex-1">
              <Label htmlFor="new-source-type" className="text-xs">Source type</Label>
              <select
                id="new-source-type"
                className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={newType}
                onChange={(e) => { setNewType(e.target.value); }}
                data-testid="sources-add-type-select"
              >
                {SOURCE_TYPES.map((t) => (
                  <option key={t} value={t}>{sourceLabel(t)}</option>
                ))}
              </select>
            </div>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={handleAdd}
              disabled={createMutation.isPending}
              data-testid="sources-add-confirm"
            >
              {createMutation.isPending ? "Adding..." : "Add"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => { setShowAddForm(false); }}
            >
              Cancel
            </Button>
          </div>
        )}

        {isLoading && <p className="text-sm text-muted-foreground">Loading sources...</p>}

        {sources?.length === 0 && !isLoading && (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No sources configured. Add your first source above.
          </p>
        )}

        {sources?.map((source) => (
          <div key={source.id} className="flex items-center justify-between gap-4 rounded-md border bg-white px-4 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="shrink-0">
                <Switch
                  aria-label={`Toggle ${sourceLabel(source.type)}`}
                  checked={source.enabled}
                  onCheckedChange={(checked) => { handleToggle(source, checked); }}
                  data-testid={`source-toggle-${source.type}`}
                />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-medium">
                  <span className="truncate">{sourceLabel(source.type)}</span>
                  {healthBadge(source)}
                </div>
                <div className="text-xs text-muted-foreground truncate">{sourceSummary(source)}</div>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => { handleDelete(source); }}
                aria-label={`Remove ${sourceLabel(source.type)}`}
                data-testid={`source-delete-${source.type}`}
                disabled={deleteMutation.isPending}
                className="min-h-[44px] min-w-[44px]"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
