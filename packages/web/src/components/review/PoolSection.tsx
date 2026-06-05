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
  facetsError: boolean;
  onRetryFacets: () => void;
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
  facetsError,
  onRetryFacets,
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

  // REQ-017: clear both the search input and the pool query when clearAll fires.
  // Cancel any pending debounce so the cleared value propagates immediately.
  function handleClearAll(): void {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearchInput("");
    pool.setQ("");
    clearAll();
  }

  // ── Branch order (must not be reordered — each branch is exclusive) ──────────
  // 1. unavailable (legacy run)           → "Pool unavailable for this run"
  // 2. pool.isError                       → section + toolbar + error + Retry
  // 3. zero-unconstrained (no error)      → return null (section hidden)
  // 4. otherwise                          → section with toolbar + items/empty-state
  // ─────────────────────────────────────────────────────────────────────────────

  // Branch 1 — EDGE-003: pool is unavailable for legacy runs that pre-date the
  // sourceTypes/startedAt fields.
  if (isUnavailable) {
    return (
      <section className="mt-8 border-t pt-6">
        <p className="text-sm text-gray-500">Pool unavailable for this run</p>
      </section>
    );
  }

  // A "constraint" is any active filter or non-empty search that narrows the pool.
  const hasConstraints =
    isFiltered || searchInput.trim() !== "" || pool.q !== "";

  // Branch 2 — REQ-003, EDGE-001: query error always renders (even when total === 0)
  // so the operator can retry — never silently collapses to null.
  if (pool.isError) {
    return (
      <section className="mt-8 border-t pt-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">
            Item Pool
          </h2>
        </div>

        <ReviewToolbar
          shortlistedOnly={shortlistedOnly}
          toggleShortlisted={toggleShortlisted}
          shortlistedItemIds={shortlistedItemIds}
          sourceTypes={sourceTypes}
          selectedSourceTypes={selectedSourceTypes}
          toggleSourceType={toggleSourceType}
          selectedSources={selectedSources}
          toggleSource={toggleSource}
          clearAll={handleClearAll}
          facets={facets}
          facetsLoading={facetsLoading}
          facetsError={facetsError}
          onRetryFacets={onRetryFacets}
          poolTotalCount={pool.total}
          isFiltered={isFiltered}
        />

        <div role="alert" className="rounded-md bg-red-50 border border-red-200 p-3 flex items-center justify-between gap-3">
          <p className="text-sm text-red-700">Failed to load pool items.</p>
          <button
            type="button"
            onClick={pool.refetch}
            className="shrink-0 rounded-md bg-red-100 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-200 transition-colors"
          >
            Retry
          </button>
        </div>
      </section>
    );
  }

  // Branch 3 — REQ-002: zero-unconstrained → unmount the section entirely.
  // Only applies when there truly are no items AND no filter/search is active.
  if (pool.total === 0 && !pool.isLoading && !hasConstraints) {
    return null;
  }

  // Branch 4 — normal section (handles: loading, items present, zero-match-filtered)
  const visibleItems = pool.items.filter(
    (i) => !pool.promotedIds.has(i.id) && !promotingIds.has(i.id),
  );

  const showEmptyState = visibleItems.length === 0 && !pool.isLoading;
  // REQ-006: context-aware empty message
  const emptyMessage = hasConstraints
    ? "No items match the current filters."
    : "All collected items are already ranked.";

  // Header count: "…" while a filter transition is in flight (total === null, REQ-005)
  const headerCount =
    pool.total === null ? "…" : `${String(pool.total)} items`;

  return (
    <section className="mt-8 border-t pt-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">
          Item Pool{" "}
          <span className="font-normal text-gray-400">({headerCount})</span>
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
        clearAll={handleClearAll}
        facets={facets}
        facetsLoading={facetsLoading}
        facetsError={facetsError}
        onRetryFacets={onRetryFacets}
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
        <p className="text-sm text-gray-500 py-4 text-center">{emptyMessage}</p>
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
            Show more (
            {pool.total !== null
              ? `${String(pool.total - pool.items.length)} remaining`
              : "…"}
            )
          </button>
        </div>
      )}
    </section>
  );
}
