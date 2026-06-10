import { useState, type ReactElement } from "react";
import { useForm } from "react-hook-form";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Search, Trash2 } from "lucide-react";
import type { SourceRow, SourceType } from "@newsletter/shared";
import { getPlatformLabel } from "@newsletter/shared/services/summary-source";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  addSource,
  discover,
  listSources,
  removeSource,
  setSourceEnabled,
  type AddSourceInput,
  type DiscoveredSource,
} from "@/api/tenant-sources";

const MANUAL_TYPES: { value: SourceType; label: string }[] = [
  { value: "rss", label: "RSS / Blog" },
  { value: "reddit", label: "Reddit" },
  { value: "hn", label: "Hacker News" },
  { value: "github", label: "GitHub" },
  { value: "twitter", label: "X / Twitter" },
];

function sourceLabel(source: SourceRow): string {
  const config = source.config as Record<string, unknown>;
  const candidate =
    config.title ??
    config.name ??
    config.url ??
    config.handle ??
    config.subreddit ??
    config.repo;
  if (typeof candidate === "string" && candidate.length > 0) return candidate;
  return getPlatformLabel(source.type);
}

interface HealthDisplay {
  label: string;
  variant: "ok" | "warn" | "danger";
}

function sourceHealth(source: SourceRow): HealthDisplay {
  const health = source.health;
  const status = typeof health?.status === "string" ? health.status : null;
  if (status === "failed" || status === "error") {
    return { label: "Error", variant: "danger" };
  }
  if (status === "slow" || status === "degraded") {
    return { label: "Slow", variant: "warn" };
  }
  if (status === "ok" || status === "healthy") {
    return { label: "Healthy", variant: "ok" };
  }
  return { label: "Unknown", variant: "warn" };
}

function HealthBadge({ health }: { health: HealthDisplay }): ReactElement {
  const dotClass =
    health.variant === "ok"
      ? "bg-emerald-500"
      : health.variant === "warn"
        ? "bg-amber-500"
        : "bg-red-500";
  return (
    <Badge variant="outline">
      <span className={`size-1.5 rounded-full ${dotClass}`} aria-hidden />
      {health.label}
    </Badge>
  );
}

interface ManualForm {
  type: SourceType;
  value: string;
}

function buildManualConfig(type: SourceType, value: string): Record<string, unknown> {
  const v = value.trim();
  if (type === "reddit") return { subreddit: v.replace(/^r\//, "") };
  if (type === "twitter") return { handle: v.replace(/^@/, "") };
  if (type === "github") return { repo: v };
  if (type === "hn") return { keywords: [v] };
  return { url: v };
}

export function SourcesPanel(): ReactElement {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<DiscoveredSource[]>([]);

  const sourcesQuery = useQuery({
    queryKey: ["tenant-sources"],
    queryFn: listSources,
  });

  const manualForm = useForm<ManualForm>({
    defaultValues: { type: "rss", value: "" },
  });

  const activeCount = (sourcesQuery.data ?? []).filter((s) => s.enabled).length;

  const discoverMutation = useMutation({
    mutationFn: (q: string) => discover(q),
    onSuccess: (candidates) => {
      setSuggestions(candidates);
      if (candidates.length === 0) toast.message("No suggestions found");
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Discovery failed");
    },
  });

  const addMutation = useMutation({
    mutationFn: (input: AddSourceInput) => addSource(input),
    onSuccess: () => {
      toast.success("Source added");
      void queryClient.invalidateQueries({ queryKey: ["tenant-sources"] });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to add source");
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      setSourceEnabled(id, enabled),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tenant-sources"] });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to update source");
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => removeSource(id),
    onSuccess: () => {
      toast.success("Source removed");
      void queryClient.invalidateQueries({ queryKey: ["tenant-sources"] });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to remove source");
    },
  });

  function onDiscover(): void {
    const q = query.trim();
    if (!q) return;
    discoverMutation.mutate(q);
  }

  function onAddSuggestion(candidate: DiscoveredSource): void {
    addMutation.mutate({
      type: candidate.type,
      config: { title: candidate.title, url: candidate.url },
    });
    setSuggestions((prev) => prev.filter((s) => s.url !== candidate.url));
  }

  const onAddManual = manualForm.handleSubmit((values) => {
    if (!values.value.trim()) return;
    addMutation.mutate({
      type: values.type,
      config: buildManualConfig(values.type, values.value),
    });
    manualForm.reset({ type: values.type, value: "" });
  });

  const sources = sourcesQuery.data ?? [];

  return (
    <Card id="sources">
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Sources</CardTitle>
          <CardDescription>
            Where your pipeline collects from. Discover new ones, add your own,
            toggle any off.
          </CardDescription>
        </div>
        <Badge variant="secondary">{activeCount} active</Badge>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="source-discover">Discover sources</Label>
          <div className="flex gap-2">
            <Input
              id="source-discover"
              placeholder="Search a topic…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onDiscover();
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              onClick={onDiscover}
              disabled={discoverMutation.isPending}
              className="min-h-[44px]"
            >
              <Search className="size-4" />
              {discoverMutation.isPending ? "Searching..." : "Search"}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            From your topic (LLM + Tavily). Click a suggestion to add it.
          </p>
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {suggestions.map((candidate) => (
                <Button
                  key={candidate.url}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onAddSuggestion(candidate);
                  }}
                >
                  <Plus className="size-3" />
                  {candidate.title}
                </Button>
              ))}
            </div>
          )}
        </div>

        <form
          className="space-y-2"
          onSubmit={(e) => {
            void onAddManual(e);
          }}
        >
          <Label htmlFor="manual-source-value">Add manually</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              aria-label="Source type"
              className="h-9 rounded-md border bg-transparent px-3 text-sm sm:max-w-[160px]"
              {...manualForm.register("type")}
            >
              {MANUAL_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <Input
              id="manual-source-value"
              placeholder="https://example.com/feed.xml or r/… or @handle"
              {...manualForm.register("value")}
            />
            <Button
              type="submit"
              variant="outline"
              disabled={addMutation.isPending}
              className="min-h-[44px]"
            >
              Add
            </Button>
          </div>
        </form>

        <div className="space-y-2">
          <Label>Your sources</Label>
          {sourcesQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading sources…</p>
          ) : sources.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No sources yet. Discover or add one above.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead className="text-right">On</TableHead>
                  <TableHead className="text-right">Remove</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sources.map((source) => (
                  <TableRow key={source.id}>
                    <TableCell className="font-medium">
                      {sourceLabel(source)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {getPlatformLabel(source.type)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <HealthBadge health={sourceHealth(source)} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Switch
                        aria-label={`Enable ${sourceLabel(source)}`}
                        checked={source.enabled}
                        onCheckedChange={(enabled) => {
                          toggleMutation.mutate({ id: source.id, enabled });
                        }}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${sourceLabel(source)}`}
                        onClick={() => {
                          removeMutation.mutate(source.id);
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
