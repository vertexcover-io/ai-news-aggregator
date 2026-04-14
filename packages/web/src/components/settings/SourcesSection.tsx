import type { ReactElement } from "react";
import { Controller, type Control, useWatch } from "react-hook-form";
import { Pencil } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import type { SettingsFormValues } from "../../pages/settingsSchema";
import type {
  RunSubmitHnConfig,
  RunSubmitRedditConfig,
  RunSubmitWebConfig,
} from "@newsletter/shared";

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

export function SourcesSection({ control }: SourcesSectionProps): ReactElement {
  const hn = useWatch({ control, name: "hnConfig" });
  const reddit = useWatch({ control, name: "redditConfig" });
  const web = useWatch({ control, name: "webConfig" });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sources</CardTitle>
        <CardDescription>
          Toggle sources and edit their configs. At least one must be enabled.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <SourceRow
          label="Hacker News"
          summary={summarizeHn(hn)}
          enabled={hn !== null}
          onToggle={(on) => {
            // mutated by Controller render below
            return on;
          }}
        >
          <Controller
            control={control}
            name="hnConfig"
            render={({ field }) => (
              <Switch
                aria-label="Hacker News"
                checked={field.value !== null}
                onCheckedChange={(checked) => {
                  field.onChange(checked ? DEFAULT_HN : null);
                }}
              />
            )}
          />
        </SourceRow>
        <SourceRow
          label="Reddit"
          summary={summarizeReddit(reddit)}
          enabled={reddit !== null}
          onToggle={(on) => on}
        >
          <Controller
            control={control}
            name="redditConfig"
            render={({ field }) => (
              <Switch
                aria-label="Reddit"
                checked={field.value !== null}
                onCheckedChange={(checked) => {
                  field.onChange(checked ? DEFAULT_REDDIT : null);
                }}
              />
            )}
          />
        </SourceRow>
        <SourceRow
          label="Web (blog listings)"
          summary={summarizeWeb(web)}
          enabled={web !== null}
          onToggle={(on) => on}
        >
          <Controller
            control={control}
            name="webConfig"
            render={({ field }) => (
              <Switch
                aria-label="Web (blog listings)"
                checked={field.value !== null}
                onCheckedChange={(checked) => {
                  field.onChange(checked ? DEFAULT_WEB : null);
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
  summary: string;
  enabled: boolean;
  onToggle: (next: boolean) => boolean;
  children: ReactElement;
}

function SourceRow({
  label,
  summary,
  children,
}: SourceRowProps): ReactElement {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border bg-white px-4 py-3">
      <div className="flex items-center gap-3">
        {children}
        <div>
          <div className="font-medium">{label}</div>
          <div className="text-xs text-muted-foreground">{summary}</div>
        </div>
      </div>
      <Button type="button" variant="ghost" size="sm" disabled>
        <Pencil />
        Edit
      </Button>
    </div>
  );
}
