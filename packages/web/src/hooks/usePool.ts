import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PoolItem } from "@newsletter/shared";
import { getPool } from "../api/archives";

export interface UsePoolOptions {
  runId: string;
  enabled: boolean;
}

export interface UsePoolReturn {
  items: PoolItem[];
  /** `null` means "no total for the current filter key yet" (transition in flight). */
  total: number | null;
  sort: "engagement" | "recency";
  source: string | undefined;
  sourceTypes: string[];
  sources: string[];
  shortlisted: boolean;
  q: string;
  offset: number;
  isLoading: boolean;
  isError: boolean;
  hasMore: boolean;
  promotedIds: Set<number>;
  setSort: (sort: "engagement" | "recency") => void;
  setSource: (source: string | undefined) => void;
  setSourceTypes: (sourceTypes: string[]) => void;
  setSources: (sources: string[]) => void;
  setShortlisted: (shortlisted: boolean) => void;
  setQ: (q: string) => void;
  loadMore: () => void;
  addPromotedId: (id: number) => void;
  refetch: () => void;
}

const PAGE_SIZE = 20;

export function usePool({ runId, enabled }: UsePoolOptions): UsePoolReturn {
  const [sort, setSortState] = useState<"engagement" | "recency">("engagement");
  const [source, setSourceState] = useState<string | undefined>(undefined);
  const [sourceTypes, setSourceTypesState] = useState<string[]>([]);
  const [sources, setSourcesState] = useState<string[]>([]);
  const [shortlisted, setShortlistedState] = useState(false);
  const [q, setQState] = useState("");
  const [offset, setOffset] = useState(0);
  const [accumulated, setAccumulated] = useState<PoolItem[]>([]);
  // Transition-aware total: track total alongside the filter key that produced it.
  // Expose `null` when the current key has no confirmed total yet (REQ-005, EDGE-005).
  const [totalState, setTotalState] = useState({
    total: 0,
    key: "",
  });
  const [promotedIds, setPromotedIds] = useState<Set<number>>(() => new Set());
  const [prevFilterKey, setPrevFilterKey] = useState("");

  const sourceTypesKey = sourceTypes.slice().sort().join(",");
  const sourcesKey = sources.slice().sort().join(",");
  const queryKey = [
    "pool",
    runId,
    sort,
    source,
    sourceTypesKey,
    sourcesKey,
    shortlisted,
    q,
    offset,
  ] as const;

  const query = useQuery({
    queryKey,
    queryFn: () =>
      getPool(runId, {
        sort,
        source: source ?? undefined,
        sourceTypes: sourceTypes.length > 0 ? sourceTypes : undefined,
        sources: sources.length > 0 ? sources : undefined,
        shortlisted: shortlisted || undefined,
        q: q || undefined,
        offset,
        limit: PAGE_SIZE,
      }),
    enabled,
    refetchOnWindowFocus: false,
  });

  const currentKey = `${sort}:${source ?? ""}:${sourceTypesKey}:${sourcesKey}:${String(shortlisted)}:${q}`;

  // Render-time sync: follow the "store previous value in state" pattern
  // used by useReview.ts to avoid effects that call setState.
  if (query.data) {
    if (currentKey !== prevFilterKey) {
      setPrevFilterKey(currentKey);
      setAccumulated(query.data.items);
      setTotalState({ total: query.data.total, key: currentKey });
    } else if (offset > 0) {
      // loadMore — append new items
      const existingIds = new Set(accumulated.map((i) => i.id));
      const newItems = query.data.items.filter((i) => !existingIds.has(i.id));
      if (newItems.length > 0) {
        setAccumulated([...accumulated, ...newItems]);
      }
      if (totalState.total !== query.data.total) {
        setTotalState({ total: query.data.total, key: currentKey });
      }
    } else if (accumulated.length === 0 && query.data.items.length > 0) {
      // Initial load
      setAccumulated(query.data.items);
      setTotalState({ total: query.data.total, key: currentKey });
    }
  }

  const setSort = useCallback((s: "engagement" | "recency") => {
    setSortState(s);
    setOffset(0);
    setAccumulated([]);
  }, []);

  const setSource = useCallback((s: string | undefined) => {
    setSourceState(s);
    setOffset(0);
    setAccumulated([]);
  }, []);

  const setSources = useCallback((s: string[]) => {
    setSourcesState(s);
    setOffset(0);
    setAccumulated([]);
  }, []);

  const setSourceTypes = useCallback((s: string[]) => {
    setSourceTypesState(s);
    setOffset(0);
    setAccumulated([]);
  }, []);

  const setShortlisted = useCallback((v: boolean) => {
    setShortlistedState(v);
    setOffset(0);
    setAccumulated([]);
  }, []);

  const setQ = useCallback((newQ: string) => {
    setQState(newQ);
    setOffset(0);
    setAccumulated([]);
  }, []);

  const loadMore = useCallback(() => {
    setOffset((prev) => prev + PAGE_SIZE);
  }, []);

  const addPromotedId = useCallback((id: number) => {
    setPromotedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  // `total` is null when the current filter key has no confirmed response yet.
  const total: number | null =
    totalState.key === currentKey ? totalState.total : null;

  // hasMore requires a confirmed total for the current key; false during transitions.
  const hasMore = useMemo(
    () => totalState.key === currentKey && accumulated.length < totalState.total,
    [accumulated.length, totalState, currentKey],
  );

  // query.refetch is referentially stable in react-query v5, so depending on
  // it (not the whole result object) keeps this callback memoized.
  const queryRefetch = query.refetch;
  const refetch = useCallback(() => {
    void queryRefetch();
  }, [queryRefetch]);

  return {
    items: accumulated,
    total,
    sort,
    source,
    sourceTypes,
    sources,
    shortlisted,
    q,
    offset,
    isLoading: query.isLoading,
    isError: query.isError,
    hasMore,
    promotedIds,
    setSort,
    setSource,
    setSourceTypes,
    setSources,
    setShortlisted,
    setQ,
    loadMore,
    addPromotedId,
    refetch,
  };
}
