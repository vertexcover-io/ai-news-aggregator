import { useState, type ReactElement } from "react";
import type { RawItemSummary } from "@newsletter/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRunSources } from "@/hooks/useRunSources";

type SourceType = RawItemSummary["sourceType"];

const SOURCE_LABEL: Record<SourceType, string> = {
  hn: "HN",
  reddit: "Reddit",
  twitter: "Twitter",
  blog: "Blog",
  rss: "RSS",
  github: "GitHub",
  newsletter: "Newsletter",
};

const SOURCE_ORDER: readonly SourceType[] = [
  "hn",
  "reddit",
  "twitter",
  "blog",
  "rss",
  "github",
  "newsletter",
];

interface SourcesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runId: string | null;
  runStartedAt?: string | null;
}

function formatHeaderDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const RTF = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function formatRelative(value: string): string {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = then - Date.now();
  const diffSec = Math.round(diffMs / 1000);
  const absSec = Math.abs(diffSec);
  if (absSec < 60) return RTF.format(diffSec, "second");
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return RTF.format(diffMin, "minute");
  const diffHr = Math.round(diffMin / 60);
  if (Math.abs(diffHr) < 24) return RTF.format(diffHr, "hour");
  const diffDay = Math.round(diffHr / 24);
  if (Math.abs(diffDay) < 30) return RTF.format(diffDay, "day");
  const diffMonth = Math.round(diffDay / 30);
  if (Math.abs(diffMonth) < 12) return RTF.format(diffMonth, "month");
  const diffYear = Math.round(diffDay / 365);
  return RTF.format(diffYear, "year");
}

function groupBySource(
  items: RawItemSummary[],
): { sourceType: SourceType; items: RawItemSummary[] }[] {
  const groups = new Map<SourceType, RawItemSummary[]>();
  for (const item of items) {
    const bucket = groups.get(item.sourceType);
    if (bucket) {
      bucket.push(item);
    } else {
      groups.set(item.sourceType, [item]);
    }
  }
  return SOURCE_ORDER.filter((s) => groups.has(s)).map((sourceType) => ({
    sourceType,
    items: groups.get(sourceType) ?? [],
  }));
}

function Thumbnail({
  imageUrl,
  alt,
}: {
  imageUrl: string | null;
  alt: string;
}): ReactElement {
  const [errored, setErrored] = useState(false);
  if (imageUrl === null || errored) {
    return (
      <div
        aria-hidden="true"
        className="h-10 w-10 shrink-0 rounded bg-stone-100"
      />
    );
  }
  return (
    <img
      src={imageUrl}
      alt={alt}
      loading="lazy"
      onError={() => {
        setErrored(true);
      }}
      className="h-10 w-10 shrink-0 rounded object-cover"
    />
  );
}

function ItemRow({ item }: { item: RawItemSummary }): ReactElement {
  const ts = item.publishedAt ?? item.collectedAt;
  return (
    <li className="flex items-start gap-3 py-2">
      <Thumbnail imageUrl={item.imageUrl} alt="" />
      <div className="min-w-0 flex-1">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block truncate text-sm font-medium text-stone-900 hover:underline"
        >
          {item.title}
        </a>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{item.author ?? "—"}</span>
          <span>{`⭐ ${String(item.engagement.points)}`}</span>
          <span>{`💬 ${String(item.engagement.commentCount)}`}</span>
          <span>{formatRelative(ts)}</span>
        </div>
      </div>
    </li>
  );
}

function SourcesBody({ runId }: { runId: string }): ReactElement {
  const query = useRunSources({ runId, enabled: true });

  if (query.isPending) {
    return (
      <ul className="space-y-2">
        {["s1", "s2", "s3", "s4", "s5", "s6"].map((key) => (
          <li
            key={key}
            data-testid="source-skeleton"
            className="flex items-start gap-3 py-2"
          >
            <div className="h-10 w-10 shrink-0 rounded bg-stone-100" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-3/4 rounded bg-stone-100" />
              <div className="h-2 w-1/2 rounded bg-stone-100" />
            </div>
          </li>
        ))}
      </ul>
    );
  }

  if (query.isError) {
    return (
      <div className="space-y-3 py-4 text-sm">
        <p className="text-rose-600">Failed to load sources.</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void query.refetch();
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  const items = query.data.items;
  if (items.length === 0) {
    return (
      <p className="py-6 text-sm text-muted-foreground">
        No raw items collected for this run.
      </p>
    );
  }

  const groups = groupBySource(items);
  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <section key={group.sourceType}>
          <h3
            data-source-group-header={group.sourceType}
            className="source-group-header mb-1 text-xs font-semibold uppercase tracking-wide text-stone-600"
          >
            {`${SOURCE_LABEL[group.sourceType]} · ${String(group.items.length)} items`}
          </h3>
          <ul className="divide-y divide-stone-100">
            {group.items.map((item) => (
              <ItemRow key={item.id} item={item} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function SourcesSubtitle({ runId }: { runId: string }): ReactElement | null {
  const query = useRunSources({ runId, enabled: true });
  if (!query.data) return null;
  const items = query.data.items;
  const collectorCount = new Set(items.map((i) => i.sourceType)).size;
  return (
    <>
      {`${String(items.length)} items collected by ${String(collectorCount)} collectors`}
    </>
  );
}

export function SourcesDialog({
  open,
  onOpenChange,
  runId,
  runStartedAt,
}: SourcesDialogProps): ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        {runId === null ? null : (
          <>
            <DialogHeader>
              <DialogTitle>
                {runStartedAt
                  ? `Sources — ${formatHeaderDate(runStartedAt)}`
                  : "Sources"}
              </DialogTitle>
              <DialogDescription>
                <SourcesSubtitle runId={runId} />
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[70vh] overflow-y-auto">
              <SourcesBody runId={runId} />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
