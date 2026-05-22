import { useCallback, useEffect, useState } from "react";
import type { Tier } from "@newsletter/shared/types/eval-ranking";

export interface GradingProgress {
  labels: Record<number, Tier>;
  setLabel: (rawItemId: number, tier: Tier) => void;
  clearAll: () => void;
  isComplete: (clusterRepIds: number[]) => boolean;
}

function storageKey(fixtureId: string, gradedBy: string): string {
  return `eval-grade:${fixtureId}:${gradedBy}`;
}

function loadInitial(key: string): Record<number, Tier> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<number, Tier>;
    }
    return {};
  } catch {
    return {};
  }
}

export function useGradingProgress(
  fixtureId: string,
  gradedBy: string,
): GradingProgress {
  const key = storageKey(fixtureId, gradedBy);
  const [labels, setLabels] = useState<Record<number, Tier>>(() =>
    loadInitial(key),
  );

  // Re-load if key changes (fixture or grader switch).
  useEffect(() => {
    setLabels(loadInitial(key));
  }, [key]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (fixtureId.length === 0 || gradedBy.length === 0) return;
    try {
      if (Object.keys(labels).length === 0) {
        window.localStorage.removeItem(key);
      } else {
        window.localStorage.setItem(key, JSON.stringify(labels));
      }
    } catch {
      // localStorage may be unavailable; ignore.
    }
  }, [key, labels, fixtureId, gradedBy]);

  const setLabel = useCallback((rawItemId: number, tier: Tier): void => {
    setLabels((prev) => ({ ...prev, [rawItemId]: tier }));
  }, []);

  const clearAll = useCallback((): void => {
    setLabels({});
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // ignore
      }
    }
  }, [key]);

  const isComplete = useCallback(
    (clusterRepIds: number[]): boolean => {
      if (clusterRepIds.length === 0) return false;
      return clusterRepIds.every((id) => id in labels);
    },
    [labels],
  );

  return { labels, setLabel, clearAll, isComplete };
}
