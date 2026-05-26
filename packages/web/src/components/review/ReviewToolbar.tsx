import { useState, type ReactElement } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SourceFacetGroup } from "../../hooks/useSourceFacets";

interface ReviewToolbarProps {
  shortlistedOnly: boolean;
  toggleShortlisted: () => void;
  shortlistedItemIds: number[] | null;
  selectedSources: Set<string>;
  toggleSource: (identifier: string) => void;
  clearAll: () => void;
  facets: SourceFacetGroup[];
  facetsLoading: boolean;
  poolTotalCount: number;
  isFiltered: boolean;
}

export function ReviewToolbar({
  shortlistedOnly,
  toggleShortlisted,
  shortlistedItemIds,
  selectedSources,
  toggleSource,
  clearAll,
  facets,
  facetsLoading,
  poolTotalCount,
  isFiltered,
}: ReviewToolbarProps): ReactElement {
  const [sourceOpen, setSourceOpen] = useState(false);
  const [facetSearch, setFacetSearch] = useState("");

  const hasShortlist = shortlistedItemIds !== null;
  const disabledTitle = hasShortlist
    ? undefined
    : "No shortlist data for this run";

  const filteredFacets = facetSearch
    ? facets.map((g) => ({
        ...g,
        facets: g.facets.filter((f) =>
          `${f.displayName} ${f.sourceIdentifier}`
            .toLowerCase()
            .includes(facetSearch.toLowerCase()),
        ),
      })).filter((g) => g.facets.length > 0)
    : facets;

  // Map an active identifier back to its human label for the chips row.
  const displayNameFor = (identifier: string): string => {
    for (const g of facets) {
      for (const f of g.facets) {
        if (f.sourceIdentifier === identifier) return f.displayName;
      }
    }
    return identifier;
  };

  return (
    <div className="flex flex-wrap items-start gap-3">
      {/* Shortlisted only toggle */}
      <div
        className="flex items-center gap-2"
        title={disabledTitle}
      >
        <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-gray-700">
          <input
            type="checkbox"
            role="checkbox"
            aria-label="Shortlisted only"
            checked={shortlistedOnly}
            onChange={toggleShortlisted}
            disabled={!hasShortlist}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-400 disabled:opacity-40 disabled:cursor-not-allowed"
          />
          <span className={cn(!hasShortlist && "opacity-40")}>
            Shortlisted only
          </span>
        </label>
      </div>

      {/* Source dropdown */}
      <div className="relative">
        <button
          type="button"
          onClick={() => {
            setSourceOpen((o) => !o);
          }}
          className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 min-h-[36px]"
        >
          Source
          {selectedSources.size > 0 && (
            <span className="ml-1 rounded-full bg-blue-600 text-white text-xs px-1.5">
              {selectedSources.size}
            </span>
          )}
          <span className="ml-1 text-gray-400">▾</span>
        </button>

        {sourceOpen && (
          <div className="absolute left-0 top-full mt-1 z-20 w-64 rounded-md border border-gray-200 bg-white shadow-lg">
            <div className="p-2 border-b border-gray-100">
              <input
                type="text"
                placeholder="Filter sources..."
                value={facetSearch}
                onChange={(e) => {
                  setFacetSearch(e.target.value);
                }}
                className="w-full rounded border border-gray-200 px-2 py-1 text-xs focus:outline-none focus:border-blue-400"
              />
            </div>
            <div className="max-h-60 overflow-y-auto p-1">
              {facetsLoading && (
                <p className="text-xs text-gray-400 px-2 py-1">Loading...</p>
              )}
              {!facetsLoading && filteredFacets.length === 0 && (
                <p className="text-xs text-gray-400 px-2 py-1">
                  No sources found
                </p>
              )}
              {filteredFacets.map((group) => (
                <div key={group.sourceType} className="mb-1">
                  <div className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                    {group.sourceType}
                  </div>
                  {group.facets.map((facet) => (
                    <button
                      key={facet.sourceIdentifier}
                      type="button"
                      onClick={() => {
                        toggleSource(facet.sourceIdentifier);
                      }}
                      className={cn(
                        "flex w-full items-center justify-between rounded px-2 py-1 text-xs hover:bg-gray-50",
                        selectedSources.has(facet.sourceIdentifier) &&
                          "bg-blue-50 text-blue-700 font-medium",
                      )}
                    >
                      <span>{facet.displayName}</span>
                      <span className="text-gray-400">{facet.count}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Active chips */}
      <div className="flex flex-wrap items-center gap-1">
        {Array.from(selectedSources).map((identifier) => (
          <span
            key={identifier}
            className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700"
          >
            {displayNameFor(identifier)}
            <button
              type="button"
              aria-label={`Remove ${displayNameFor(identifier)}`}
              onClick={() => {
                toggleSource(identifier);
              }}
              className="ml-0.5 hover:text-blue-900"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>

      {/* Clear filters */}
      {isFiltered && (
        <button
          type="button"
          onClick={clearAll}
          className="text-xs text-gray-500 hover:text-gray-700 underline min-h-[36px]"
        >
          Clear filters
        </button>
      )}

      {/* Count */}
      <div className="ml-auto text-xs text-gray-500 self-center">
        {poolTotalCount} {isFiltered ? "matching" : "items"}
      </div>
    </div>
  );
}
