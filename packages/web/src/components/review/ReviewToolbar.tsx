import { useState, useRef, useEffect, type ReactElement } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SourceFacetGroup } from "../../hooks/useSourceFacets";
import {
  SourceCatalog,
  type SourceCatalogSection,
} from "../sources/SourceCatalog";
import { sourceTypeLabel } from "../sources/sourceCatalogUtils";

const SOURCE_TYPES_WITHOUT_SOURCE_ROWS = new Set(["hn", "web_search"]);

interface ReviewToolbarProps {
  shortlistedOnly: boolean;
  toggleShortlisted: () => void;
  shortlistedItemIds: number[] | null;
  sourceTypes: string[];
  selectedSourceTypes: Set<string>;
  toggleSourceType: (sourceType: string) => void;
  selectedSources: Set<string>;
  toggleSource: (identifier: string) => void;
  clearAll: () => void;
  facets: SourceFacetGroup[];
  facetsLoading: boolean;
  facetsError: boolean;
  onRetryFacets: () => void;
  /** `null` when the pool count is unavailable (filter transition in flight). */
  poolTotalCount: number | null;
  isFiltered: boolean;
}

export function ReviewToolbar({
  shortlistedOnly,
  toggleShortlisted,
  shortlistedItemIds,
  sourceTypes,
  selectedSourceTypes,
  toggleSourceType,
  selectedSources,
  toggleSource,
  clearAll,
  facets,
  facetsLoading,
  facetsError,
  onRetryFacets,
  poolTotalCount,
  isFiltered,
}: ReviewToolbarProps): ReactElement {
  const [sourceOpen, setSourceOpen] = useState(false);
  const [facetSearch, setFacetSearch] = useState("");
  const dropdownContainerRef = useRef<HTMLDivElement | null>(null);

  // REQ-014: close dropdown on outside click or Escape key
  useEffect(() => {
    if (!sourceOpen) return;

    function handleMouseDown(e: MouseEvent): void {
      if (
        dropdownContainerRef.current &&
        !dropdownContainerRef.current.contains(e.target as Node)
      ) {
        setSourceOpen(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        setSourceOpen(false);
      }
    }

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [sourceOpen]);

  const hasShortlist =
    shortlistedItemIds !== null && shortlistedItemIds.length > 0;
  const disabledTitle = hasShortlist
    ? undefined
    : "No shortlist data for this run";

  const sourceTypeOrder = Array.from(
    new Set([
      ...sourceTypes,
      ...facets.map((group) => group.sourceType),
    ]),
  );
  const facetsByType = new Map(facets.map((group) => [group.sourceType, group.facets]));

  const menuSections: SourceCatalogSection[] = sourceTypeOrder
    .map((sourceType) => {
      const groupFacets = facetsByType.get(sourceType) ?? [];
      const total = groupFacets.reduce((sum, facet) => sum + facet.count, 0);
      const rows = [
        {
          id: `collector:${sourceType}`,
          displayName: sourceTypeLabel(sourceType),
          count: total > 0 ? total : undefined,
          selected: selectedSourceTypes.has(sourceType),
          onSelect: () => {
            toggleSourceType(sourceType);
          },
        },
        ...(
          SOURCE_TYPES_WITHOUT_SOURCE_ROWS.has(sourceType)
            ? []
            : groupFacets.map((facet) => ({
                id: `source:${facet.sourceIdentifier}`,
                displayName: facet.displayName,
                count: facet.count,
                selected: selectedSources.has(facet.sourceIdentifier),
                onSelect: () => {
                  toggleSource(facet.sourceIdentifier);
                },
              }))
        ),
      ];

      return {
        sourceType,
        label: sourceTypeLabel(sourceType),
        rows,
      };
    })
    .filter((section) => section.rows.length > 0);

  const filteredSections = facetSearch
    ? menuSections
        .map((section) => ({
          ...section,
          rows: section.rows.filter((row) =>
            `${section.label ?? section.sourceType} ${row.displayName} ${row.id}`
              .toLowerCase()
              .includes(facetSearch.toLowerCase()),
          ),
        }))
        .filter((section) => section.rows.length > 0)
    : menuSections;

  const activeFilterCount = selectedSourceTypes.size + selectedSources.size;

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
      <div className="relative" ref={dropdownContainerRef}>
        <button
          type="button"
          onClick={() => {
            setSourceOpen((o) => !o);
          }}
          className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 min-h-[36px]"
        >
          Source
          {activeFilterCount > 0 && (
            <span className="ml-1 rounded-full bg-blue-600 text-white text-xs px-1.5">
              {activeFilterCount}
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
              {!facetsLoading && facetsError && (
                <div
                  role="alert"
                  className="flex items-center justify-between gap-2 px-2 py-2"
                >
                  <p className="text-xs text-red-600">Failed to load sources.</p>
                  <button
                    type="button"
                    onClick={onRetryFacets}
                    className="shrink-0 rounded bg-red-100 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-200 transition-colors"
                  >
                    Retry
                  </button>
                </div>
              )}
              {!facetsLoading && !facetsError && (
                <SourceCatalog
                  sections={filteredSections}
                  variant="menu"
                  emptyMessage="No sources found"
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Active chips */}
      <div className="flex flex-wrap items-center gap-1">
        {Array.from(selectedSourceTypes).map((sourceType) => (
          <span
            key={`collector:${sourceType}`}
            className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700"
          >
            {sourceTypeLabel(sourceType)}
            <button
              type="button"
              aria-label={`Remove ${sourceTypeLabel(sourceType)}`}
              onClick={() => {
                toggleSourceType(sourceType);
              }}
              className="ml-0.5 hover:text-blue-900"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
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

      {/* Count — shows "…" while a filter transition is in flight (total is null) */}
      <div className="ml-auto text-xs text-gray-500 self-center">
        {poolTotalCount ?? "…"}{" "}
        {isFiltered ? "matching" : "items"}
      </div>
    </div>
  );
}
