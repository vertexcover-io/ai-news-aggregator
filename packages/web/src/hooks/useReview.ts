import { useCallback, useMemo, useState } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { RankedItem } from "@newsletter/shared";
import { getAdminArchive, type RunStateResponse } from "../api/runs";

export interface PendingAdd {
  tempId: string;
  url: string;
}

export interface PendingPromote {
  tempId: string;
  rawItemId: number;
  title: string;
}

export interface ReviewState {
  initial: RankedItem[];
  current: RankedItem[];
  pending: PendingAdd[];
  pendingPromotes: PendingPromote[];
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
  addPromotePending: (p: PendingPromote) => void;
  resolvePromotePending: (tempId: string, item: RankedItem) => void;
  failPromotePending: (tempId: string) => void;
  discard: () => void;
  reset: (items: RankedItem[]) => void;
  hasUrl: (url: string) => boolean;
  updateItemField: (
    id: number,
    field: "title" | "summary" | "bullets" | "bottomLine" | "imageUrl",
    value: string | string[] | null,
  ) => void;
}

function sameOrder(a: RankedItem[], b: RankedItem[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i]?.id !== b[i]?.id) return false;
  }
  return true;
}

function itemFieldsChanged(a: RankedItem, b: RankedItem): boolean {
  if (a.title !== b.title) return true;
  if (a.imageUrl !== b.imageUrl) return true;
  if (a.recap?.summary !== b.recap?.summary) return true;
  if (a.recap?.bottomLine !== b.recap?.bottomLine) return true;
  const ab = a.recap?.bullets ?? [];
  const bb = b.recap?.bullets ?? [];
  if (ab.length !== bb.length) return true;
  return ab.some((bullet, i) => bullet !== bb[i]);
}

const POLL_INTERVAL_MS = 5000;
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

export function useReview(runId: string): UseReviewResult {
  const query = useQuery<RunStateResponse | null>({
    queryKey: ["archive", runId],
    queryFn: () => getAdminArchive(runId),
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      if (status !== undefined && !TERMINAL_STATUSES.has(status)) {
        return POLL_INTERVAL_MS;
      }
      return false;
    },
  });

  const [initial, setInitial] = useState<RankedItem[]>([]);
  const [current, setCurrent] = useState<RankedItem[]>([]);
  const [pending, setPending] = useState<PendingAdd[]>([]);
  const [pendingPromotes, setPendingPromotes] = useState<PendingPromote[]>([]);
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

  const addPromotePending = useCallback((p: PendingPromote) => {
    setPendingPromotes((prev) => [...prev, p]);
  }, []);

  const resolvePromotePending = useCallback(
    (tempId: string, item: RankedItem) => {
      setPendingPromotes((prev) => prev.filter((p) => p.tempId !== tempId));
      setCurrent((prev) => [...prev, item]);
      setAddedIds((prev) => {
        const next = new Set(prev);
        next.add(item.id);
        return next;
      });
    },
    [],
  );

  const failPromotePending = useCallback((tempId: string) => {
    setPendingPromotes((prev) => prev.filter((p) => p.tempId !== tempId));
  }, []);

  const discard = useCallback(() => {
    setCurrent(initial);
    setPending([]);
    setPendingPromotes([]);
    setAddedIds(new Set());
  }, [initial]);

  const reset = useCallback((items: RankedItem[]) => {
    setInitial(items);
    setCurrent(items);
    setPending([]);
    setPendingPromotes([]);
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

  const updateItemField = useCallback(
    (
      id: number,
      field: "title" | "summary" | "bullets" | "bottomLine" | "imageUrl",
      value: string | string[] | null,
    ) => {
      setCurrent((prev) =>
        prev.map((item) => {
          if (item.id !== id) return item;
          if (field === "imageUrl") {
            return { ...item, imageUrl: value as string | null };
          }
          if (field === "title") {
            const next = value as string;
            return {
              ...item,
              title: next,
              recap: item.recap
                ? { ...item.recap, title: next }
                : item.recap,
            };
          }
          return {
            ...item,
            recap: {
              title: item.recap?.title ?? item.title,
              summary: item.recap?.summary ?? "",
              bullets: item.recap?.bullets ?? [],
              bottomLine: item.recap?.bottomLine ?? "",
              [field]: value,
            },
          };
        }),
      );
    },
    [],
  );

  const isDirty = useMemo(() => {
    if (pending.length > 0) return true;
    if (pendingPromotes.length > 0) return true;
    if (!sameOrder(initial, current)) return true;
    const initialMap = new Map(initial.map((it) => [it.id, it]));
    return current.some((it) => {
      const orig = initialMap.get(it.id);
      if (!orig) return false;
      return itemFieldsChanged(orig, it);
    });
  }, [initial, current, pending, pendingPromotes]);

  return {
    query,
    state: { initial, current, pending, pendingPromotes, addedIds },
    isDirty,
    reorder,
    remove,
    addPending,
    resolvePending,
    failPending,
    addPromotePending,
    resolvePromotePending,
    failPromotePending,
    discard,
    reset,
    hasUrl,
    updateItemField,
  };
}
