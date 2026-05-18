import { useEffect, useRef, useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Newspaper } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import type { PoolItem, RankedItem } from "@newsletter/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  SOURCE_BADGE_CLASSES,
  SOURCE_LABELS,
} from "@/lib/sourceDisplay";
import { usePool } from "../hooks/usePool";
import { getAdminArchive, type RunStateResponse } from "../api/runs";

type PoolSort = "engagement" | "recency";
type KnownSourceType = keyof typeof SOURCE_LABELS;

function formatHeading(startedAt: string | null | undefined): string {
  if (!startedAt) return "Sources Preview";
  const d = new Date(startedAt);
  if (Number.isNaN(d.getTime())) return "Sources Preview";
  const formatted = d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  return `Sources Preview · ${formatted}`;
}

function formatRelative(value: string | null): string {
  if (!value) return "Unknown date";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Unknown date";
  return `${formatDistanceToNow(d)} ago`;
}

function isKnownSourceType(sourceType: string): sourceType is KnownSourceType {
  return Object.prototype.hasOwnProperty.call(SOURCE_LABELS, sourceType);
}

function sourceLabel(sourceType: string): string {
  return isKnownSourceType(sourceType) ? SOURCE_LABELS[sourceType] : sourceType;
}

function sourceBadgeClass(sourceType: string): string {
  return isKnownSourceType(sourceType)
    ? SOURCE_BADGE_CLASSES[sourceType]
    : "bg-gray-100 text-gray-700";
}

function PageShell({ children }: { readonly children: ReactElement }): ReactElement {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="border-b bg-white px-4 sm:px-6 md:px-8 py-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Newspaper className="size-5" /> Newsletter
        </h1>
        <Link
          to="/admin"
          className="inline-flex items-center min-h-[44px] px-4 text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back to dashboard
        </Link>
      </header>
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 md:px-8 py-4 sm:py-6 space-y-5">
        {children}
      </main>
    </div>
  );
}

function MessageState({ message }: { readonly message: string }): ReactElement {
  return (
    <PageShell>
      <div className="rounded-lg border bg-white p-8 text-sm text-gray-700">
        {message}
      </div>
    </PageShell>
  );
}

function RankedBadge({
  sourceType,
}: {
  readonly sourceType: string;
}): ReactElement {
  return (
    <span
      className={cn(
        "px-2 py-0.5 rounded-full text-xs font-semibold uppercase",
        sourceBadgeClass(sourceType),
      )}
    >
      {sourceLabel(sourceType)}
    </span>
  );
}

function RankedItemCard({
  item,
  rank,
}: {
  readonly item: RankedItem;
  readonly rank: number;
}): ReactElement {
  return (
    <article className="relative flex flex-wrap items-stretch gap-3 sm:gap-4 rounded-lg border bg-white px-4 py-3 shadow-sm">
      <div
        aria-label="rank"
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-semibold text-white"
      >
        {rank}
      </div>

      <div className="relative size-12 shrink-0 overflow-hidden rounded bg-gray-100">
        {item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="size-full object-cover"
          />
        ) : null}
      </div>

      <div className="flex-1 min-w-0 basis-full sm:basis-auto order-last sm:order-none">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <RankedBadge sourceType={item.sourceType} />
          {item.engagement.points > 0 ? (
            <span>{item.engagement.points} points</span>
          ) : null}
          {item.engagement.commentCount > 0 ? (
            <span>{item.engagement.commentCount} comments</span>
          ) : null}
        </div>
        <div className="mt-0.5 flex items-start gap-2">
          <h3 className="flex-1 min-w-0 font-semibold text-gray-900 text-base">
            {item.title}
          </h3>
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${item.title}`}
            className="shrink-0 text-xs text-stone-400 hover:text-stone-700 hover:underline mt-1"
          >
            open ↗
          </a>
        </div>
        {item.recap ? (
          <div className="mt-1 space-y-1 text-sm text-gray-700">
            <p>{item.recap.summary}</p>
            {item.recap.bullets.length > 0 ? (
              <ul className="list-disc pl-5">
                {item.recap.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            ) : null}
            <p>{item.recap.bottomLine}</p>
          </div>
        ) : (
          <p className="mt-1 text-sm text-gray-600 line-clamp-2">
            {item.rationale}
          </p>
        )}
      </div>

      <div className="flex flex-col items-end gap-2">
        <div className="text-right">
          <div className="text-lg font-bold text-emerald-600">
            {(item.score * 10).toFixed(1)}
          </div>
          <div className="text-[10px] uppercase text-muted-foreground">
            score
          </div>
        </div>
      </div>
    </article>
  );
}

function ReadonlyRankedList({
  items,
}: {
  readonly items: readonly RankedItem[];
}): ReactElement {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wide text-gray-500">
          Ranked Items{" "}
          <span className="font-normal text-gray-400">
            ({items.length} posts)
          </span>
        </h3>
      </div>
      {items.length === 0 ? (
        <div className="rounded-lg border bg-white p-8 text-center text-sm text-muted-foreground">
          No ranked items for this run.
        </div>
      ) : (
        <ul className="space-y-3 list-none p-0">
          {items.map((item, index) => (
            <li key={item.id}>
              <RankedItemCard item={item} rank={index + 1} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PoolItemCard({ item }: { readonly item: PoolItem }): ReactElement {
  return (
    <article className="flex items-start gap-3 rounded-lg border bg-white px-4 py-3 shadow-sm">
      {item.imageUrl ? (
        <div className="size-10 shrink-0 overflow-hidden rounded bg-gray-100">
          <img
            src={item.imageUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="size-full object-cover"
          />
        </div>
      ) : (
        <div aria-hidden="true" className="size-10 shrink-0 rounded bg-gray-100" />
      )}

      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <RankedBadge sourceType={item.sourceType} />
          {item.author ? <span>{item.author}</span> : null}
          {item.engagement.points > 0 ? (
            <span>{item.engagement.points} pts</span>
          ) : null}
          {item.engagement.commentCount > 0 ? (
            <span>{item.engagement.commentCount} comments</span>
          ) : null}
          <span className="text-gray-400">{formatRelative(item.publishedAt)}</span>
        </div>
        <div className="mt-0.5 flex items-start gap-2">
          <h3 className="flex-1 min-w-0 truncate text-sm font-medium text-gray-900">
            {item.title}
          </h3>
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${item.title}`}
            className="shrink-0 text-xs text-stone-400 hover:text-stone-700 hover:underline mt-1"
          >
            open ↗
          </a>
        </div>
      </div>
    </article>
  );
}

function SourceFilterButton({
  label,
  active,
  onClick,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center rounded-full px-3 py-1 text-xs font-medium transition-colors min-h-[44px] min-w-[44px]",
        active
          ? "bg-blue-600 text-white"
          : "bg-gray-100 text-gray-600 hover:bg-gray-200",
      )}
    >
      {label}
    </button>
  );
}

function SortButton({
  label,
  active,
  onClick,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center rounded-full px-3 py-1 text-xs font-medium transition-colors min-h-[44px] min-w-[44px]",
        active
          ? "bg-gray-900 text-white"
          : "bg-gray-100 text-gray-600 hover:bg-gray-200",
      )}
    >
      {label}
    </button>
  );
}

function ReadonlySourcePool({
  runId,
  sourceTypes,
  enabled,
}: {
  readonly runId: string;
  readonly sourceTypes: readonly string[];
  readonly enabled: boolean;
}): ReactElement {
  const pool = usePool({ runId, enabled });
  const [searchInput, setSearchInput] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function handleSearchChange(value: string): void {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      pool.setQ(value);
    }, 300);
  }

  function handleSort(sort: PoolSort): void {
    pool.setSort(sort);
  }

  return (
    <section className="mt-8 border-t pt-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wide text-gray-500">
          Source Pool{" "}
          <span className="font-normal text-gray-400">
            ({pool.total} items)
          </span>
        </h3>
      </div>
      <p className="text-sm text-muted-foreground">
        Items collected for this run that were not selected for the ranked digest.
      </p>

      <input
        type="text"
        placeholder="Search pool items..."
        value={searchInput}
        onChange={(e) => {
          handleSearchChange(e.target.value);
        }}
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 min-h-[44px]"
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500 mr-1">Sort:</span>
          <SortButton
            label="Engagement"
            active={pool.sort === "engagement"}
            onClick={() => {
              handleSort("engagement");
            }}
          />
          <SortButton
            label="Recent"
            active={pool.sort === "recency"}
            onClick={() => {
              handleSort("recency");
            }}
          />
        </div>

        <div className="h-4 w-px bg-gray-300" />

        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500 mr-1">Source:</span>
          <SourceFilterButton
            label="All"
            active={pool.source === undefined}
            onClick={() => {
              pool.setSource(undefined);
            }}
          />
          {sourceTypes.map((sourceType) => (
            <SourceFilterButton
              key={sourceType}
              label={sourceLabel(sourceType)}
              active={pool.source === sourceType}
              onClick={() => {
                pool.setSource(sourceType);
              }}
            />
          ))}
        </div>
      </div>

      {pool.items.length === 0 && !pool.isLoading ? (
        <p className="text-sm text-gray-500 py-4 text-center">
          All collected items are already ranked.
        </p>
      ) : (
        <div className="space-y-2">
          {pool.items.map((item) => (
            <PoolItemCard key={item.id} item={item} />
          ))}
        </div>
      )}

      {pool.isLoading ? (
        <p className="text-sm text-gray-400 text-center py-2">Loading...</p>
      ) : null}

      {pool.hasMore && !pool.isLoading ? (
        <div className="text-center">
          <Button variant="outline" size="sm" onClick={pool.loadMore}>
            Show more ({pool.total - pool.items.length} remaining)
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function CompletedSourcesView({
  runId,
  run,
}: {
  readonly runId: string;
  readonly run: RunStateResponse;
}): ReactElement {
  const rankedItems = run.rankedItems ?? [];
  const sourceTypes = run.sourceTypes ?? [];
  return (
    <PageShell>
      <>
        <div>
          <h2 className="text-2xl font-bold">{formatHeading(run.startedAt)}</h2>
          <p className="text-sm text-muted-foreground">
            Read-only view of ranked stories and collected source pool.
          </p>
        </div>
        <ReadonlyRankedList items={rankedItems} />
        <ReadonlySourcePool
          runId={runId}
          sourceTypes={sourceTypes}
          enabled={sourceTypes.length > 0}
        />
      </>
    </PageShell>
  );
}

export function SourcesPreviewPage(): ReactElement {
  const { runId = "" } = useParams<{ runId: string }>();
  const query = useQuery<RunStateResponse | null>({
    queryKey: ["archive", runId],
    queryFn: () => getAdminArchive(runId),
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (query.isLoading) {
    return (
      <PageShell>
        <div>
          <h2 className="text-2xl font-bold">Sources Preview</h2>
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </PageShell>
    );
  }

  if (query.data === null || query.data === undefined) {
    return <MessageState message="This run was not found." />;
  }

  if (query.data.status !== "completed") {
    return <MessageState message="This run is not ready for source preview yet." />;
  }

  return <CompletedSourcesView runId={runId} run={query.data} />;
}
