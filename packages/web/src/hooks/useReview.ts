import { useCallback, useMemo, useState } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { RankedItem } from "@newsletter/shared";
import { getArchive, type RunStateResponse } from "../api/runs";

export interface PendingAdd {
  tempId: string;
  url: string;
}

export interface ReviewState {
  initial: RankedItem[];
  current: RankedItem[];
  pending: PendingAdd[];
  addedIds: Set<number>;
}

export interface UseReviewResult {
  query: UseQueryResult<RunStateResponse | null>;
  state: ReviewState;
  isDirty: boolean;
  reorder: (fromIndex: number, toIndex: number) => void;
  remove: (id: number) => void;
  addPending: (pending: PendingAdd) => void;
  resolvePending: (tempId: string, item: RankedItem) => void;
  failPending: (tempId: string) => void;
  discard: () => void;
  reset: (items: RankedItem[]) => void;
  hasUrl: (url: string) => boolean;
}

function sameOrder(a: RankedItem[], b: RankedItem[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i]?.id !== b[i]?.id) return false;
  }
  return true;
}

export function useReview(runId: string): UseReviewResult {
  const query = useQuery<RunStateResponse | null>({
    queryKey: ["archive", runId],
    queryFn: () => getArchive(runId),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const [initial, setInitial] = useState<RankedItem[]>([]);
  const [current, setCurrent] = useState<RankedItem[]>([]);
  const [pending, setPending] = useState<PendingAdd[]>([]);
  const [addedIds, setAddedIds] = useState<Set<number>>(() => new Set());
  const [hydratedId, setHydratedId] = useState<string | null>(null);

  // Render-time hydration: when a new completed response arrives, sync state.
  // This is the "store previous value in state" pattern — preferable to an
  // effect + setState (which eslint-plugin-react-hooks flags as cascading).
  const completedKey =
    query.data?.status === "completed" ? query.data.id : null;
  if (completedKey !== null && completedKey !== hydratedId) {
    const items = query.data?.rankedItems ?? [];
    setInitial(items);
    setCurrent(items);
    setHydratedId(completedKey);
  }

  const reorder = useCallback((fromIndex: number, toIndex: number) => {
    setCurrent((prev) => {
      if (fromIndex === toIndex) return prev;
      if (fromIndex < 0 || fromIndex >= prev.length) return prev;
      if (toIndex < 0 || toIndex >= prev.length) return prev;
      const next = prev.slice();
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const remove = useCallback((id: number) => {
    setCurrent((prev) => prev.filter((it) => it.id !== id));
    setAddedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const addPending = useCallback((p: PendingAdd) => {
    setPending((prev) => [...prev, p]);
  }, []);

  const resolvePending = useCallback((tempId: string, item: RankedItem) => {
    setPending((prev) => prev.filter((p) => p.tempId !== tempId));
    setCurrent((prev) => [...prev, item]);
    setAddedIds((prev) => {
      const next = new Set(prev);
      next.add(item.id);
      return next;
    });
  }, []);

  const failPending = useCallback((tempId: string) => {
    setPending((prev) => prev.filter((p) => p.tempId !== tempId));
  }, []);

  const discard = useCallback(() => {
    setCurrent(initial);
    setPending([]);
    setAddedIds(new Set());
  }, [initial]);

  const reset = useCallback((items: RankedItem[]) => {
    setInitial(items);
    setCurrent(items);
    setPending([]);
    setAddedIds(new Set());
  }, []);

  const hasUrl = useCallback(
    (url: string) => {
      const normalized = url.trim().toLowerCase();
      if (current.some((it) => it.url.trim().toLowerCase() === normalized))
        return true;
      if (pending.some((p) => p.url.trim().toLowerCase() === normalized))
        return true;
      return false;
    },
    [current, pending],
  );

  const isDirty = useMemo(
    () => pending.length > 0 || !sameOrder(initial, current),
    [initial, current, pending],
  );

  return {
    query,
    state: { initial, current, pending, addedIds },
    isDirty,
    reorder,
    remove,
    addPending,
    resolvePending,
    failPending,
    discard,
    reset,
    hasUrl,
  };
}
