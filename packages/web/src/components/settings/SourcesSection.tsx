import { useState } from "react";
import type { ReactElement } from "react";
import {
  Controller,
  type Control,
  type UseFormRegister,
  type UseFormSetValue,
  useFieldArray,
  useWatch,
} from "react-hook-form";
import { Pencil, ChevronUp, Trash2, Activity } from "lucide-react";
import type {
  CollectorHealthResult,
  HealthCheckCollector,
} from "@newsletter/shared/types";
import { useCollectorHealth, useCollectorHealthTrigger } from "../../hooks/useCollectorHealth";
import { CollectorHealthModal } from "./CollectorHealthModal";
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
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type {
  SettingsFormValues,
  TwitterFormConfig,
} from "../../pages/settingsSchema";
import type {
  RunSubmitHnConfig,
  RunSubmitRedditConfig,
  RunSubmitWebConfig,
} from "@newsletter/shared";
import type { RunSubmitWebSearchConfig } from "@newsletter/shared/types";

const DEFAULT_HN: RunSubmitHnConfig = {
  keywords: ["ai", "llm", "agents"],
  pointsThreshold: 100,
  sinceDays: 1,
  count: 50,
  feeds: ["newest", "best"],
  commentsPerItem: 10,
};

const DEFAULT_REDDIT: RunSubmitRedditConfig = {
  subreddits: ["MachineLearning", "LocalLLaMA"],
  sort: "hot",
  limit: 25,
  sinceDays: 1,
};

const DEFAULT_WEB: RunSubmitWebConfig = {
  sources: [
    { name: "Anthropic", listingUrl: "https://www.anthropic.com/news" },
  ],
  maxItems: 10,
  sinceDays: 7,
};

interface SourcesSectionProps {
  control: Control<SettingsFormValues>;
  register: UseFormRegister<SettingsFormValues>;
  setValue: UseFormSetValue<SettingsFormValues>;
}

const DEFAULT_TWITTER: TwitterFormConfig = {
  listIds: [],
  users: [],
  maxTweetsPerSource: 50,
  sinceHours: 24,
};

const DEFAULT_WEB_SEARCH: RunSubmitWebSearchConfig = {
  provider: "tavily",
  queries: [],
};

function summarizeTwitter(c: SettingsFormValues["twitterConfig"]): string {
  if (!c) return "Disabled";
  const parts: string[] = [];
  parts.push(
    `${String(c.listIds.length)} list${c.listIds.length === 1 ? "" : "s"}`,
  );
  parts.push(
    `${String(c.users.length)} user${c.users.length === 1 ? "" : "s"}`,
  );
  if (c.maxTweetsPerSource !== undefined)
    parts.push(`${String(c.maxTweetsPerSource)} tweets/source`);
  if (c.sinceHours !== undefined)
    parts.push(`last ${String(c.sinceHours)}h`);
  return parts.join(" · ");
}

function summarizeHn(c: RunSubmitHnConfig | null): string {
  if (!c) return "Disabled";
  const parts: string[] = [];
  if (c.keywords && c.keywords.length > 0)
    parts.push(`Keywords: ${c.keywords.join(", ")}`);
  if (c.pointsThreshold !== undefined)
    parts.push(`${String(c.pointsThreshold)}+ points`);
  parts.push(`last ${String(c.sinceDays)} day${c.sinceDays === 1 ? "" : "s"}`);
  if (c.count !== undefined) parts.push(`${String(c.count)} items`);
  return parts.join(" · ");
}

function summarizeReddit(c: RunSubmitRedditConfig | null): string {
  if (!c) return "Disabled";
  const parts: string[] = [];
  parts.push(`Subreddits: ${c.subreddits.join(", ")}`);
  if (c.sort !== undefined) parts.push(c.sort);
  if (c.limit !== undefined) parts.push(`${String(c.limit)} items`);
  parts.push(`last ${String(c.sinceDays)} day${c.sinceDays === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

function summarizeWeb(c: RunSubmitWebConfig | null): string {
  if (!c) return "Disabled";
  const names = c.sources.map((s) => s.name).join(", ");
  return `${String(c.sources.length)} blog${c.sources.length === 1 ? "" : "s"} configured: ${names}`;
}

export function summarizeWebSearch(c: RunSubmitWebSearchConfig | null): string {
  if (!c || c.queries.length === 0) return "Disabled";
  return `${String(c.queries.length)} ${c.queries.length === 1 ? "query" : "queries"} · ${c.provider}`;
}

function summarizeSource(enabled: boolean, configSummary: string): string {
  if (enabled) return configSummary;
  return configSummary === "Disabled" ? "Disabled" : `Disabled · ${configSummary}`;
}

export function SourcesSection({
  control,
  register,
  setValue,
}: SourcesSectionProps): ReactElement {
  const [expandedSource, setExpandedSource] = useState<
    "hn" | "reddit" | "web" | "twitter" | "webSearch" | null
  >(null);

  const [modalCollector, setModalCollector] = useState<HealthCheckCollector | null>(null);
  const { data: healthSnapshot } = useCollectorHealth();
  const { trigger: triggerCheck } = useCollectorHealthTrigger();

  function getHealthResult(collector: HealthCheckCollector): CollectorHealthResult | null {
    return healthSnapshot?.collectors.find((c) => c.collector === collector) ?? null;
  }

  function handleCheckCollector(collector: HealthCheckCollector): void {
    triggerCheck(collector);
    setModalCollector(collector);
  }

  function handleCheckAll(): void {
    triggerCheck(undefined);
  }

  const hn = useWatch({ control, name: "hnConfig" });
  const hnEnabled = useWatch({ control, name: "hnEnabled" });
  const reddit = useWatch({ control, name: "redditConfig" });
  const redditEnabled = useWatch({ control, name: "redditEnabled" });
  const web = useWatch({ control, name: "webConfig" });
  const webEnabled = useWatch({ control, name: "webEnabled" });
  const twitter = useWatch({ control, name: "twitterConfig" });
  const twitterEnabled = useWatch({ control, name: "twitterEnabled" });
  const webSearch = useWatch({ control, name: "webSearchConfig" });
  const webSearchEnabled = useWatch({ control, name: "webSearchEnabled" });

  function toggleExpand(source: "hn" | "reddit" | "web" | "twitter" | "webSearch"): void {
    setExpandedSource((prev) => (prev === source ? null : source));
  }

  const modalResult = modalCollector !== null ? getHealthResult(modalCollector) : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Sources</CardTitle>
            <CardDescription>
              Toggle sources and edit their configs. At least one must be enabled.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCheckAll}
            aria-label="Check all collectors"
            data-testid="check-all-button"
            className="shrink-0"
          >
            <Activity className="h-4 w-4 mr-1" />
            Check all
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <CollectorHealthModal
          open={modalCollector !== null}
          onOpenChange={(open) => {
            if (!open) setModalCollector(null);
          }}
          result={modalResult}
        />
        <SourceRow
          label="Hacker News"
          summary={summarizeSource(hnEnabled, summarizeHn(hn))}
          editable={hn !== null}
          expanded={expandedSource === "hn"}
          onEdit={() => {
            if (hn === null) {
              setValue("hnConfig", DEFAULT_HN, {
                shouldDirty: true,
                shouldTouch: true,
              });
            }
            toggleExpand("hn");
          }}
          onCheck={() => { handleCheckCollector("hn"); }}
          editPanel={
            <HnEditPanel control={control} />
          }
        >
          <Controller
            control={control}
            name="hnEnabled"
            render={({ field }) => (
              <Switch
                aria-label="Hacker News"
                checked={field.value}
                onCheckedChange={(checked) => {
                  if (checked && hn === null) {
                    setValue("hnConfig", DEFAULT_HN, {
                      shouldDirty: true,
                      shouldTouch: true,
                    });
                  }
                  field.onChange(checked);
                }}
              />
            )}
          />
        </SourceRow>
        <SourceRow
          label="Reddit"
          summary={summarizeSource(redditEnabled, summarizeReddit(reddit))}
          editable={reddit !== null}
          expanded={expandedSource === "reddit"}
          onEdit={() => {
            if (reddit === null) {
              setValue("redditConfig", DEFAULT_REDDIT, {
                shouldDirty: true,
                shouldTouch: true,
              });
            }
            toggleExpand("reddit");
          }}
          onCheck={() => { handleCheckCollector("reddit"); }}
          editPanel={
            <RedditEditPanel control={control} />
          }
        >
          <Controller
            control={control}
            name="redditEnabled"
            render={({ field }) => (
              <Switch
                aria-label="Reddit"
                checked={field.value}
                onCheckedChange={(checked) => {
                  if (checked && reddit === null) {
                    setValue("redditConfig", DEFAULT_REDDIT, {
                      shouldDirty: true,
                      shouldTouch: true,
                    });
                  }
                  field.onChange(checked);
                }}
              />
            )}
          />
        </SourceRow>
        <SourceRow
          label="Web (blog listings)"
          summary={summarizeSource(webEnabled, summarizeWeb(web))}
          editable={web !== null}
          expanded={expandedSource === "web"}
          onEdit={() => {
            if (web === null) {
              setValue("webConfig", DEFAULT_WEB, {
                shouldDirty: true,
                shouldTouch: true,
              });
            }
            toggleExpand("web");
          }}
          onCheck={() => { handleCheckCollector("blog"); }}
          editPanel={
            <WebEditPanel control={control} />
          }
        >
          <Controller
            control={control}
            name="webEnabled"
            render={({ field }) => (
              <Switch
                aria-label="Web (blog listings)"
                checked={field.value}
                onCheckedChange={(checked) => {
                  if (checked && web === null) {
                    setValue("webConfig", DEFAULT_WEB, {
                      shouldDirty: true,
                      shouldTouch: true,
                    });
                  }
                  field.onChange(checked);
                }}
              />
            )}
          />
        </SourceRow>
        <SourceRow
          label="Twitter / X"
          summary={summarizeSource(twitterEnabled, summarizeTwitter(twitter))}
          editable={twitter !== null}
          expanded={expandedSource === "twitter"}
          onEdit={() => {
            if (twitter === null) {
              setValue("twitterConfig", { ...DEFAULT_TWITTER }, {
                shouldDirty: true,
                shouldTouch: true,
              });
            }
            toggleExpand("twitter");
          }}
          onCheck={() => { handleCheckCollector("twitter"); }}
          editPanel={
            <TwitterEditPanel control={control} register={register} />
          }
        >
          <Controller
            control={control}
            name="twitterEnabled"
            render={({ field }) => (
              <Switch
                aria-label="Twitter / X"
                checked={field.value}
                onCheckedChange={(checked) => {
                  if (checked && twitter === null) {
                    setValue("twitterConfig", { ...DEFAULT_TWITTER }, {
                      shouldDirty: true,
                      shouldTouch: true,
                    });
                  }
                  field.onChange(checked);
                }}
              />
            )}
          />
        </SourceRow>
        <SourceRow
          label="Web Search"
          labelExtra={<Badge variant="secondary" className="ml-2 text-xs text-muted-foreground">Tavily</Badge>}
          summary={summarizeSource(webSearchEnabled, summarizeWebSearch(webSearch))}
          editable={webSearch !== null}
          expanded={expandedSource === "webSearch"}
          testId="web-search-card"
          onEdit={() => {
            if (webSearch === null) {
              setValue("webSearchConfig", { ...DEFAULT_WEB_SEARCH }, {
                shouldDirty: true,
                shouldTouch: true,
              });
            }
            toggleExpand("webSearch");
          }}
          onCheck={() => { handleCheckCollector("web_search"); }}
          editPanel={
            <WebSearchEditPanel control={control} />
          }
        >
          <Controller
            control={control}
            name="webSearchEnabled"
            render={({ field }) => (
              <Switch
                aria-label="Web Search"
                checked={field.value}
                onCheckedChange={(checked) => {
                  if (checked && webSearch === null) {
                    setValue("webSearchConfig", { ...DEFAULT_WEB_SEARCH }, {
                      shouldDirty: true,
                      shouldTouch: true,
                    });
                  }
                  field.onChange(checked);
                }}
              />
            )}
          />
        </SourceRow>
      </CardContent>
    </Card>
  );
}

interface SourceRowProps {
  label: string;
  labelExtra?: ReactElement;
  summary: string;
  editable: boolean;
  expanded: boolean;
  onEdit: () => void;
  onCheck: () => void;
  editPanel: ReactElement;
  children: ReactElement;
  testId?: string;
}

function SourceRow({
  label,
  labelExtra,
  summary,
  editable,
  expanded,
  onEdit,
  onCheck,
  editPanel,
  children,
  testId,
}: SourceRowProps): ReactElement {
  return (
    <div className="rounded-md border bg-white" data-testid={testId}>
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-3">
          {children}
          <div>
            <div className="flex items-center font-medium">
              {label}
              {labelExtra}
            </div>
            <div className="text-xs text-muted-foreground">{summary}</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCheck}
            aria-label={`Check ${label}`}
            data-testid={`check-button-${label.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
            className="min-h-[44px] min-w-[44px]"
          >
            <Activity className="h-4 w-4" />
            Check
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onEdit}
            aria-expanded={expanded}
            aria-label={`${label} ${expanded ? "Close" : "Edit"}`}
            className="min-h-[44px] min-w-[44px]"
          >
            {expanded ? <ChevronUp /> : <Pencil />}
            {expanded ? "Close" : "Edit"}
          </Button>
        </div>
      </div>
      {expanded && editable && (
        <div className="border-t px-4 pb-4 pt-3">{editPanel}</div>
      )}
    </div>
  );
}

function HnEditPanel({
  control,
}: {
  control: Control<SettingsFormValues>;
}): ReactElement {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <div className="col-span-2 sm:col-span-3">
        <Label htmlFor="hn-keywords" className="text-xs">
          Keywords (comma-separated)
        </Label>
        <Controller
          control={control}
          name="hnConfig.keywords"
          render={({ field }) => (
            <Input
              id="hn-keywords"
              className="mt-1"
              value={(field.value ?? []).join(", ")}
              onChange={(e) => {
                field.onChange(
                  e.target.value.split(",").map((k) => k.trimStart()),
                );
              }}
            />
          )}
        />
      </div>
      <div>
        <Label htmlFor="hn-points" className="text-xs">
          Min points
        </Label>
        <Controller
          control={control}
          name="hnConfig.pointsThreshold"
          render={({ field }) => (
            <Input
              id="hn-points"
              type="number"
              className="mt-1"
              min={0}
              value={field.value ?? ""}
              onChange={(e) => {
                field.onChange(
                  e.target.value === "" ? undefined : Number(e.target.value),
                );
              }}
            />
          )}
        />
      </div>
      <div>
        <Label htmlFor="hn-since" className="text-xs">
          Since (days)
        </Label>
        <Controller
          control={control}
          name="hnConfig.sinceDays"
          render={({ field }) => (
            <Input
              id="hn-since"
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
      <div>
        <Label htmlFor="hn-count" className="text-xs">
          Max items
        </Label>
        <Controller
          control={control}
          name="hnConfig.count"
          render={({ field }) => (
            <Input
              id="hn-count"
              type="number"
              className="mt-1"
              min={1}
              max={1000}
              value={field.value ?? ""}
              onChange={(e) => {
                field.onChange(
                  e.target.value === "" ? undefined : Number(e.target.value),
                );
              }}
            />
          )}
        />
      </div>
      <div>
        <Label htmlFor="hn-comments" className="text-xs">
          Comments per item
        </Label>
        <Controller
          control={control}
          name="hnConfig.commentsPerItem"
          render={({ field }) => (
            <Input
              id="hn-comments"
              type="number"
              className="mt-1"
              min={0}
              max={100}
              value={field.value ?? ""}
              onChange={(e) => {
                field.onChange(
                  e.target.value === "" ? undefined : Number(e.target.value),
                );
              }}
            />
          )}
        />
      </div>
      <div className="col-span-2">
        <Label className="text-xs">Feeds</Label>
        <Controller
          control={control}
          name="hnConfig.feeds"
          render={({ field }) => {
            const feeds = field.value ?? [];
            function toggle(feed: "newest" | "best"): void {
              if (feeds.includes(feed)) {
                field.onChange(feeds.filter((f) => f !== feed));
              } else {
                field.onChange([...feeds, feed]);
              }
            }
            return (
              <div className="mt-1 flex gap-4">
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={feeds.includes("newest")}
                    onChange={() => {
                      toggle("newest");
                    }}
                  />
                  newest
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={feeds.includes("best")}
                    onChange={() => {
                      toggle("best");
                    }}
                  />
                  best
                </label>
              </div>
            );
          }}
        />
      </div>
    </div>
  );
}

function RedditEditPanel({
  control,
}: {
  control: Control<SettingsFormValues>;
}): ReactElement {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="col-span-2">
        <Label htmlFor="reddit-subs" className="text-xs">
          Subreddits (comma-separated)
        </Label>
        <Controller
          control={control}
          name="redditConfig.subreddits"
          render={({ field }) => (
            <Input
              id="reddit-subs"
              className="mt-1"
              placeholder="MachineLearning, LocalLLaMA"
              value={field.value.join(", ")}
              onChange={(e) => {
                field.onChange(
                  e.target.value.split(",").map((s) => s.trimStart()),
                );
              }}
            />
          )}
        />
      </div>
      <div>
        <Label htmlFor="reddit-sort" className="text-xs">
          Sort
        </Label>
        <Controller
          control={control}
          name="redditConfig.sort"
          render={({ field }) => (
            <select
              id="reddit-sort"
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={field.value ?? "hot"}
              onChange={(e) => {
                field.onChange(e.target.value as "hot" | "new" | "top");
              }}
            >
              <option value="hot">hot</option>
              <option value="new">new</option>
              <option value="top">top</option>
            </select>
          )}
        />
      </div>
      <div>
        <Label htmlFor="reddit-limit" className="text-xs">
          Limit
        </Label>
        <Controller
          control={control}
          name="redditConfig.limit"
          render={({ field }) => (
            <Input
              id="reddit-limit"
              type="number"
              className="mt-1"
              min={1}
              max={100}
              value={field.value ?? ""}
              onChange={(e) => {
                field.onChange(
                  e.target.value === "" ? undefined : Number(e.target.value),
                );
              }}
            />
          )}
        />
      </div>
      <div>
        <Label htmlFor="reddit-since" className="text-xs">
          Since (days)
        </Label>
        <Controller
          control={control}
          name="redditConfig.sinceDays"
          render={({ field }) => (
            <Input
              id="reddit-since"
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
  );
}

function WebEditPanel({
  control,
}: {
  control: Control<SettingsFormValues>;
}): ReactElement {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_2fr_auto] gap-2 text-xs text-muted-foreground px-1">
        <span>Name</span>
        <span>URL</span>
        <span />
      </div>
      <Controller
        control={control}
        name="webConfig.sources"
        render={({ field }) => (
          <>
            {field.value.map((source, index) => (
              <div key={index} className="grid grid-cols-[1fr_2fr_auto] items-center gap-2">
                <Input
                  placeholder="Anthropic"
                  value={source.name}
                  onChange={(e) => {
                    const updated = field.value.map((s, i) =>
                      i === index ? { ...s, name: e.target.value } : s,
                    );
                    field.onChange(updated);
                  }}
                />
                <Input
                  type="url"
                  placeholder="https://www.anthropic.com/news"
                  value={source.listingUrl}
                  onChange={(e) => {
                    const updated = field.value.map((s, i) =>
                      i === index ? { ...s, listingUrl: e.target.value } : s,
                    );
                    field.onChange(updated);
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    field.onChange(field.value.filter((_, i) => i !== index));
                  }}
                  aria-label={`Remove ${source.name || "source"}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-1"
              onClick={() => {
                field.onChange([...field.value, { name: "", listingUrl: "" }]);
              }}
            >
              Add source
            </Button>
          </>
        )}
      />
      <div className="grid grid-cols-2 gap-3 pt-2">
        <div>
          <Label htmlFor="web-max" className="text-xs">
            Max items
          </Label>
          <Controller
            control={control}
            name="webConfig.maxItems"
            render={({ field }) => (
              <Input
                id="web-max"
                type="number"
                className="mt-1"
                min={1}
                max={100}
                value={field.value}
                onChange={(e) => {
                  field.onChange(Number(e.target.value));
                }}
              />
            )}
          />
        </div>
        <div>
          <Label htmlFor="web-since" className="text-xs">
            Since (days)
          </Label>
          <Controller
            control={control}
            name="webConfig.sinceDays"
            render={({ field }) => (
              <Input
                id="web-since"
                type="number"
                className="mt-1"
                min={1}
                value={field.value ?? ""}
                onChange={(e) => {
                  field.onChange(
                    e.target.value === "" ? undefined : Number(e.target.value),
                  );
                }}
              />
            )}
          />
        </div>
      </div>
    </div>
  );
}

function WebSearchEditPanel({
  control,
}: {
  control: Control<SettingsFormValues>;
}): ReactElement {
  const {
    fields,
    append,
    remove,
  } = useFieldArray({ control, name: "webSearchConfig.queries" });

  return (
    <div className="space-y-2">
      {fields.length > 0 && (
        <div className="grid grid-cols-[1fr_80px_80px_auto] gap-2 px-1 text-xs text-muted-foreground">
          <span>Query</span>
          <span>Days back</span>
          <span>Max items</span>
          <span />
        </div>
      )}
      {fields.map((field, idx) => (
        <div key={field.id} className="grid grid-cols-[1fr_80px_80px_auto] items-center gap-2">
          <Controller
            control={control}
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            name={`webSearchConfig.queries.${idx}.query` as const}
            render={({ field: f }) => (
              <Input
                placeholder="AI safety research"
                value={f.value}
                onChange={f.onChange}
                aria-label={`Query ${String(idx + 1)}`}
              />
            )}
          />
          <Controller
            control={control}
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            name={`webSearchConfig.queries.${idx}.sinceDays` as const}
            render={({ field: f }) => (
              <Input
                type="number"
                min={1}
                max={30}
                value={f.value}
                onChange={(e) => { f.onChange(Number(e.target.value)); }}
                aria-label={`Days back for query ${String(idx + 1)}`}
              />
            )}
          />
          <Controller
            control={control}
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            name={`webSearchConfig.queries.${idx}.maxItems` as const}
            render={({ field: f }) => (
              <Input
                type="number"
                min={1}
                max={20}
                value={f.value}
                onChange={(e) => { f.onChange(Number(e.target.value)); }}
                aria-label={`Max items for query ${String(idx + 1)}`}
              />
            )}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => { remove(idx); }}
            aria-label={`Remove query ${String(idx + 1)}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-1"
        onClick={() => { append({ query: "", sinceDays: 7, maxItems: 5 }); }}
      >
        Add query
      </Button>
    </div>
  );
}

function TwitterEditPanel({
  control,
  register,
}: {
  control: Control<SettingsFormValues>;
  register: UseFormRegister<SettingsFormValues>;
}): ReactElement {
  const {
    fields: listFields,
    append: appendList,
    remove: removeList,
  } = useFieldArray({ control, name: "twitterConfig.listIds" });

  const {
    fields: userFields,
    append: appendUser,
    remove: removeUser,
  } = useFieldArray({ control, name: "twitterConfig.users" });

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 text-xs font-medium text-muted-foreground">
          Twitter Lists
        </div>
        <div className="space-y-2">
          {listFields.map((field, idx) => (
            <div
              key={field.id}
              className="grid grid-cols-[1fr_auto] items-center gap-2"
            >
              <Input
                placeholder="1585430245762441216"
                aria-label={`Twitter list ${String(idx + 1)}`}
                {...register(`twitterConfig.listIds.${String(idx)}.value` as `twitterConfig.listIds.${number}.value`)}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  removeList(idx);
                }}
                aria-label={`Remove list ${String(idx + 1)}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => {
            appendList({ value: "" });
          }}
        >
          Add list
        </Button>
      </div>

      <div>
        <div className="mb-2 text-xs font-medium text-muted-foreground">
          Twitter Users
        </div>
        <div className="space-y-2">
          {userFields.map((field, idx) => (
            <div
              key={field.id}
              className="grid grid-cols-[1fr_auto] items-center gap-2"
            >
              <Input
                placeholder="@jack"
                aria-label={`Twitter handle ${String(idx + 1)}`}
                {...register(`twitterConfig.users.${String(idx)}.handle` as `twitterConfig.users.${number}.handle`)}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  removeUser(idx);
                }}
                aria-label={`Remove handle ${String(idx + 1)}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => {
            appendUser({ handle: "", userId: "" });
          }}
        >
          Add user
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="twitter-max-tweets" className="text-xs">
            Max tweets per source
          </Label>
          <Controller
            control={control}
            name="twitterConfig.maxTweetsPerSource"
            render={({ field }) => (
              <Input
                id="twitter-max-tweets"
                type="number"
                className="mt-1"
                min={1}
                max={500}
                value={field.value ?? ""}
                onChange={(e) => {
                  field.onChange(
                    e.target.value === "" ? undefined : Number(e.target.value),
                  );
                }}
              />
            )}
          />
        </div>
        <div>
          <Label htmlFor="twitter-since-hours" className="text-xs">
            Since (hours)
          </Label>
          <Controller
            control={control}
            name="twitterConfig.sinceHours"
            render={({ field }) => (
              <Input
                id="twitter-since-hours"
                type="number"
                className="mt-1"
                min={1}
                max={168}
                value={field.value ?? ""}
                onChange={(e) => {
                  field.onChange(
                    e.target.value === "" ? undefined : Number(e.target.value),
                  );
                }}
              />
            )}
          />
        </div>
      </div>
    </div>
  );
}
