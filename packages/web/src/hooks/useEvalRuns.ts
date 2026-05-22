import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import type { EvalRunStatus } from "@newsletter/shared/types/eval-ranking";
import {
  listEvalRuns,
  type ListEvalRunsResponse,
} from "../api/eval";

export type RunsMode = "scored" | "ab";

export interface RunsFilterValue {
  q: string;
  mode: RunsMode | "";
  status: EvalRunStatus | "";
  fixtureId: string;
}

const DEFAULT_PER_PAGE = 20;
const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_MIN_CHARS = 2;

function parseMode(raw: string | null): RunsMode | "" {
  return raw === "scored" || raw === "ab" ? raw : "";
}

function parseStatus(raw: string | null): EvalRunStatus | "" {
  return raw === "running" || raw === "done" || raw === "failed" ? raw : "";
}

function parsePage(raw: string | null): number {
  const n = raw === null ? 1 : Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export interface UseEvalRunsResult {
  filter: RunsFilterValue;
  setFilter: (next: RunsFilterValue) => void;
  page: number;
  perPage: number;
  setPage: (next: number) => void;
  data: ListEvalRunsResponse | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useEvalRuns(): UseEvalRunsResult {
  const [searchParams, setSearchParams] = useSearchParams();

  const filter: RunsFilterValue = useMemo(
    () => ({
      q: searchParams.get("q") ?? "",
      mode: parseMode(searchParams.get("mode")),
      status: parseStatus(searchParams.get("status")),
      fixtureId: searchParams.get("fixtureId") ?? "",
    }),
    [searchParams],
  );

  const page = parsePage(searchParams.get("page"));
  const perPage = DEFAULT_PER_PAGE;

  const [debouncedQ, setDebouncedQ] = useState(filter.q);
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedQ(filter.q);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(handle);
    };
  }, [filter.q]);

  const effectiveQ =
    debouncedQ.trim().length >= SEARCH_MIN_CHARS ? debouncedQ.trim() : "";

  const query = useQuery<ListEvalRunsResponse>({
    queryKey: [
      "eval-runs",
      {
        page,
        perPage,
        mode: filter.mode,
        status: filter.status,
        fixtureId: filter.fixtureId,
        q: effectiveQ,
      },
    ],
    queryFn: () =>
      listEvalRuns({
        page,
        perPage,
        ...(filter.mode === "" ? {} : { mode: filter.mode }),
        ...(filter.status === "" ? {} : { status: filter.status }),
        ...(filter.fixtureId === "" ? {} : { fixtureId: filter.fixtureId }),
      }),
    placeholderData: keepPreviousData,
  });

  const setFilter = (next: RunsFilterValue): void => {
    const params = new URLSearchParams(searchParams);
    if (next.q.length > 0) params.set("q", next.q);
    else params.delete("q");
    if (next.mode !== "") params.set("mode", next.mode);
    else params.delete("mode");
    if (next.status !== "") params.set("status", next.status);
    else params.delete("status");
    if (next.fixtureId.length > 0) params.set("fixtureId", next.fixtureId);
    else params.delete("fixtureId");
    params.delete("page");
    setSearchParams(params, { replace: true });
  };

  const setPage = (next: number): void => {
    const params = new URLSearchParams(searchParams);
    if (next <= 1) params.delete("page");
    else params.set("page", String(next));
    setSearchParams(params, { replace: true });
  };

  return {
    filter,
    setFilter,
    page,
    perPage,
    setPage,
    data: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: () => {
      void query.refetch();
    },
  };
}

