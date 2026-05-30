import { useCallback, useMemo, useState } from "react";

export interface UseReviewFiltersResult {
  shortlistedOnly: boolean;
  toggleShortlisted: () => void;
  selectedSourceTypes: Set<string>;
  toggleSourceType: (sourceType: string) => void;
  selectedSources: Set<string>;
  toggleSource: (identifier: string) => void;
  clearSources: () => void;
  clearAll: () => void;
  isFiltered: boolean;
}

export function useReviewFilters(): UseReviewFiltersResult {
  const [shortlistedOnly, setShortlistedOnly] = useState(false);
  const [selectedSources, setSelectedSources] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedSourceTypes, setSelectedSourceTypes] = useState<Set<string>>(
    () => new Set(),
  );

  const toggleShortlisted = useCallback(() => {
    setShortlistedOnly((prev) => !prev);
  }, []);

  const toggleSource = useCallback((identifier: string) => {
    setSelectedSources((prev) => {
      const next = new Set(prev);
      if (next.has(identifier)) {
        next.delete(identifier);
      } else {
        next.add(identifier);
      }
      return next;
    });
  }, []);

  const toggleSourceType = useCallback((sourceType: string) => {
    setSelectedSourceTypes((prev) => {
      const next = new Set(prev);
      if (next.has(sourceType)) {
        next.delete(sourceType);
      } else {
        next.add(sourceType);
      }
      return next;
    });
  }, []);

  const clearSources = useCallback(() => {
    setSelectedSources(new Set());
    setSelectedSourceTypes(new Set());
  }, []);

  const clearAll = useCallback(() => {
    setShortlistedOnly(false);
    setSelectedSources(new Set());
    setSelectedSourceTypes(new Set());
  }, []);

  const isFiltered = useMemo(
    () =>
      shortlistedOnly ||
      selectedSources.size > 0 ||
      selectedSourceTypes.size > 0,
    [shortlistedOnly, selectedSources, selectedSourceTypes],
  );

  return {
    shortlistedOnly,
    toggleShortlisted,
    selectedSourceTypes,
    toggleSourceType,
    selectedSources,
    toggleSource,
    clearSources,
    clearAll,
    isFiltered,
  };
}
