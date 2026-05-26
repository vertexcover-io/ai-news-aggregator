import { useCallback, useMemo, useState } from "react";

export interface UseReviewFiltersResult {
  shortlistedOnly: boolean;
  toggleShortlisted: () => void;
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

  const clearSources = useCallback(() => {
    setSelectedSources(new Set());
  }, []);

  const clearAll = useCallback(() => {
    setShortlistedOnly(false);
    setSelectedSources(new Set());
  }, []);

  const isFiltered = useMemo(
    () => shortlistedOnly || selectedSources.size > 0,
    [shortlistedOnly, selectedSources],
  );

  return {
    shortlistedOnly,
    toggleShortlisted,
    selectedSources,
    toggleSource,
    clearSources,
    clearAll,
    isFiltered,
  };
}
