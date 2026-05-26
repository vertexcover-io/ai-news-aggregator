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
  total: number;
  sort: "engagement" | "recency";
  source: string | undefined;
  sources: string[];
  shortlisted: boolean;
  q: string;
  offset: number;
  isLoading: boolean;
  hasMore: boolean;
  promotedIds: Set<number>;
  setSort: (sort: "engagement" | "recency") => void;
  setSource: (source: string | undefined) => void;
  setSources: (sources: string[]) => void;
  setShortlisted: (shortlisted: boolean) => void;
  setQ: (q: string) => void;
  loadMore: () => void;
  addPromotedId: (id: number) => void;
}

const PAGE_SIZE = 20;

export function usePool({ runId, enabled }: UsePoolOptions): UsePoolReturn {
  const [sort, setSortState] = useState<"engagement" | "recency">("engagement");
  const [source, setSourceState] = useState<string | undefined>(undefined);
  const [sources, setSourcesState] = useState<string[]>([]);
  const [shortlisted, setShortlistedState] = useState(false);
  const [q, setQState] = useState("");
  const [offset, setOffset] = useState(0);
  const [accumulated, setAccumulated] = useState<PoolItem[]>([]);
  const [total, setTotal] = useState(0);
  const [promotedIds, setPromotedIds] = useState<Set<number>>(() => new Set());
  const [prevFilterKey, setPrevFilterKey] = useState("");

  const sourcesKey = sources.slice().sort().join(",");
  const queryKey = ["pool", runId, sort, source, sourcesKey, shortlisted, q, offset] as const;

  const query = useQuery({
    queryKey,
    queryFn: () =>
      getPool(runId, {
        sort,
        source: source ?? undefined,
        sources: sources.length > 0 ? sources : undefined,
        shortlisted: shortlisted || undefined,
        q: q || undefined,
        offset,
        limit: PAGE_SIZE,
      }),
    enabled,
    refetchOnWindowFocus: false,
  });

  const currentKey = `${sort}:${source ?? ""}:${sourcesKey}:${String(shortlisted)}:${q}`;

  // Render-time sync: follow the "store previous value in state" pattern
  // used by useReview.ts to avoid effects that call setState.
  if (query.data) {
    if (currentKey !== prevFilterKey) {
      setPrevFilterKey(currentKey);
      setAccumulated(query.data.items);
      setTotal(query.data.total);
    } else if (offset > 0) {
      // loadMore — append new items
      const existingIds = new Set(accumulated.map((i) => i.id));
      const newItems = query.data.items.filter((i) => !existingIds.has(i.id));
      if (newItems.length > 0) {
        setAccumulated([...accumulated, ...newItems]);
      }
      if (total !== query.data.total) {
        setTotal(query.data.total);
      }
    } else if (accumulated.length === 0 && query.data.items.length > 0) {
      // Initial load
      setAccumulated(query.data.items);
      setTotal(query.data.total);
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

  const hasMore = useMemo(() => accumulated.length < total, [accumulated.length, total]);

  return {
    items: accumulated,
    total,
    sort,
    source,
    sources,
    shortlisted,
    q,
    offset,
    isLoading: query.isLoading,
    hasMore,
    promotedIds,
    setSort,
    setSource,
    setSources,
    setShortlisted,
    setQ,
    loadMore,
    addPromotedId,
  };
}
