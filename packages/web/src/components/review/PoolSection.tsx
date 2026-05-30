import { useEffect, useRef, useState, type ReactElement } from "react";
import { usePool, type UsePoolReturn } from "../../hooks/usePool";
import { PoolCard } from "./PoolCard";
import { ReviewToolbar } from "./ReviewToolbar";
import type { SourceFacetGroup } from "../../hooks/useSourceFacets";
import { cn } from "@/lib/utils";

interface PoolSectionProps {
  runId: string;
  isSaveInFlight: boolean;
  onPromote: (rawItemId: number, title: string) => Promise<void>;
  promotingIds: Set<number>;
  startedAt: string | null;
  sourceTypes: string[] | null;
  shortlistedOnly: boolean;
  toggleShortlisted: () => void;
  selectedSourceTypes: Set<string>;
  toggleSourceType: (sourceType: string) => void;
  selectedSources: Set<string>;
  toggleSource: (identifier: string) => void;
  clearAll: () => void;
  isFiltered: boolean;
  shortlistedItemIds: number[] | null;
  facets: SourceFacetGroup[];
  facetsLoading: boolean;
}

export function PoolSection({
  runId,
  isSaveInFlight,
  onPromote,
  promotingIds,
  startedAt,
  sourceTypes,
  shortlistedOnly,
  toggleShortlisted,
  selectedSourceTypes,
  toggleSourceType,
  selectedSources,
  toggleSource,
  clearAll,
  isFiltered,
  shortlistedItemIds,
  facets,
  facetsLoading,
}: PoolSectionProps): ReactElement | null {
  const isUnavailable = !startedAt || !sourceTypes;

  const pool: UsePoolReturn = usePool({
    runId,
    enabled: !isUnavailable,
  });

  const [searchInput, setSearchInput] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Sync selectedSources to pool server-side filter
  useEffect(() => {
    pool.setSources(Array.from(selectedSources));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Array.from(selectedSources).join(",")]);

  // Sync selected source collectors to pool server-side filter
  useEffect(() => {
    pool.setSourceTypes(Array.from(selectedSourceTypes));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Array.from(selectedSourceTypes).join(",")]);

  // Sync shortlistedOnly to pool
  useEffect(() => {
    if (shortlistedItemIds !== null) {
      pool.setShortlisted(shortlistedOnly);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortlistedOnly, shortlistedItemIds !== null]);

  function handleSearchChange(value: string): void {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      pool.setQ(value);
    }, 300);
  }

  // EDGE-002: hide entirely when total is 0 and not loading
  if (!isUnavailable && pool.total === 0 && !pool.isLoading) {
    return null;
  }

  // EDGE-006: pool unavailable for legacy runs
  if (isUnavailable) {
    return (
      <section className="mt-8 border-t pt-6">
        <p className="text-sm text-gray-500">Pool unavailable for this run</p>
      </section>
    );
  }

  // Filter out promoted items
  const visibleItems = pool.items.filter(
    (i) => !pool.promotedIds.has(i.id) && !promotingIds.has(i.id),
  );

  // EDGE-001: all items ranked
  const showEmptyState = visibleItems.length === 0 && !pool.isLoading;

  return (
    <section className="mt-8 border-t pt-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">
          Item Pool{" "}
          <span className="font-normal text-gray-400">
            ({pool.total} items)
          </span>
        </h2>
      </div>

      {/* Filter toolbar — scoped to the pool only */}
      <ReviewToolbar
        shortlistedOnly={shortlistedOnly}
        toggleShortlisted={toggleShortlisted}
        shortlistedItemIds={shortlistedItemIds}
        sourceTypes={sourceTypes}
        selectedSourceTypes={selectedSourceTypes}
        toggleSourceType={toggleSourceType}
        selectedSources={selectedSources}
        toggleSource={toggleSource}
        clearAll={clearAll}
        facets={facets}
        facetsLoading={facetsLoading}
        poolTotalCount={pool.total}
        isFiltered={isFiltered}
      />

      {/* Search */}
      <input
        type="text"
        placeholder="Search pool items..."
        value={searchInput}
        onChange={(e) => {
          handleSearchChange(e.target.value);
        }}
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 min-h-[44px]"
      />

      {/* Sort */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-gray-500 mr-1">Sort:</span>
        <button
          type="button"
          onClick={() => {
            pool.setSort("engagement");
          }}
          className={cn(
            "inline-flex items-center justify-center rounded-full px-3 py-1 text-xs font-medium transition-colors min-h-[44px] min-w-[44px]",
            pool.sort === "engagement"
              ? "bg-gray-900 text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200",
          )}
        >
          Engagement
        </button>
        <button
          type="button"
          onClick={() => {
            pool.setSort("recency");
          }}
          className={cn(
            "inline-flex items-center justify-center rounded-full px-3 py-1 text-xs font-medium transition-colors min-h-[44px] min-w-[44px]",
            pool.sort === "recency"
              ? "bg-gray-900 text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200",
          )}
        >
          Recent
        </button>
      </div>

      {/* Items */}
      {showEmptyState ? (
        <p className="text-sm text-gray-500 py-4 text-center">
          All collected items are already ranked.
        </p>
      ) : (
        <div className="space-y-2">
          {visibleItems.map((item) => (
            <PoolCard
              key={item.id}
              item={item}
              onPromote={(id, title) => {
                void onPromote(id, title);
              }}
              isPromoting={promotingIds.has(item.id)}
              isSaveInFlight={isSaveInFlight}
            />
          ))}
        </div>
      )}

      {/* Loading */}
      {pool.isLoading && (
        <p className="text-sm text-gray-400 text-center py-2">Loading...</p>
      )}

      {/* Show more */}
      {pool.hasMore && !pool.isLoading && (
        <div className="text-center">
          <button
            type="button"
            onClick={pool.loadMore}
            className="rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors"
          >
            Show more ({pool.total - pool.items.length} remaining)
          </button>
        </div>
      )}
    </section>
  );
}
