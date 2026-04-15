import type {
  RankedItem,
  RunState,
  RunSubmitPayload,
  RunSummary,
} from "@newsletter/shared";
import { apiFetch } from "./client";

export interface SubmitRunResponse {
  runId: string;
}

export type RunStateResponse = Omit<RunState, "rankedItems"> & { rankedItems: RankedItem[] | null };

interface ApiErrorBody {
  error?: string;
}

export async function submitRun(
  payload: RunSubmitPayload,
): Promise<SubmitRunResponse> {
  const res = await apiFetch("/api/runs", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(body.error ?? "Failed to submit run");
  }
  return (await res.json()) as SubmitRunResponse;
}

export async function getRun(runId: string): Promise<RunStateResponse | null> {
  const res = await apiFetch(`/api/runs/${runId}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Failed to fetch run");
  return (await res.json()) as RunStateResponse;
}

export async function getArchive(runId: string): Promise<RunStateResponse | null> {
  const res = await apiFetch(`/api/archives/${runId}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Failed to fetch archive");
  return (await res.json()) as RunStateResponse;
}

interface ListRunsResponse {
  runs: RunSummary[];
}

export async function listRuns(limit?: number): Promise<RunSummary[]> {
  const path =
    limit === undefined ? "/api/runs" : `/api/runs?limit=${String(limit)}`;
  const res = await apiFetch(path);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(body.error ?? "Failed to fetch runs");
  }
  const data = (await res.json()) as ListRunsResponse;
  return data.runs;
}

export interface TriggerRunNowResponse {
  runId: string;
}

export async function triggerRunNow(): Promise<TriggerRunNowResponse> {
  const res = await apiFetch("/api/runs/now", { method: "POST" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(body.error ?? "Failed to start run");
  }
  return (await res.json()) as TriggerRunNowResponse;
}

export type CancelRunResult =
  | { status: "ok"; run: RunState }
  | { status: "already-terminal" };

export async function cancelRun(runId: string): Promise<CancelRunResult> {
  const res = await apiFetch(`/api/runs/${runId}/cancel`, { method: "POST" });
  // 409 means the run is already in a terminal state — not an error from UI perspective
  if (res.status === 409) {
    return { status: "already-terminal" };
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(body.error ?? "Failed to cancel run");
  }
  const data = (await res.json()) as { run: RunState };
  return { status: "ok", run: data.run };
}
