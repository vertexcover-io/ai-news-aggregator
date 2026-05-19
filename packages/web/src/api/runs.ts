import type {
  RankedItem,
  RunState,
  RunSourcesResponse,
  RunSubmitPayload,
  RunSummary,
} from "@newsletter/shared";
import { apiFetch, apiFetchAdmin } from "./client";

export interface SubmitRunResponse {
  runId: string;
}

export type RunStateResponse = Omit<RunState, "rankedItems"> & {
  rankedItems: RankedItem[] | null;
  sourceTypes?: string[] | null;
  digestHeadline?: string | null;
  digestSummary?: string | null;
  hook?: string | null;
  isDryRun?: boolean;
};

interface ApiErrorBody {
  error?: string;
}

export async function submitRun(
  payload: RunSubmitPayload,
): Promise<SubmitRunResponse> {
  const res = await apiFetchAdmin("/api/runs", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(body.error ?? "Failed to submit run");
  }
  return (await res.json()) as SubmitRunResponse;
}

export async function getRunSources(
  runId: string,
): Promise<RunSourcesResponse> {
  const res = await apiFetchAdmin(`/api/admin/runs/${runId}/sources`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(body.error ?? "Failed to fetch run sources");
  }
  return (await res.json()) as RunSourcesResponse;
}

export async function getRun(runId: string): Promise<RunStateResponse | null> {
  const res = await apiFetchAdmin(`/api/runs/${runId}`);
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

export async function getAdminArchive(
  runId: string,
): Promise<RunStateResponse | null> {
  const res = await apiFetchAdmin(`/api/admin/archives/${runId}`);
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
  const res = await apiFetchAdmin(path);
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

export async function triggerRunNow(
  opts?: { dryRun?: boolean },
): Promise<TriggerRunNowResponse> {
  const init: RequestInit = { method: "POST" };
  if (opts?.dryRun === true) {
    init.body = JSON.stringify({ dryRun: true });
    init.headers = { "content-type": "application/json" };
  }
  const res = await apiFetchAdmin("/api/runs/now", init);
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
  const res = await apiFetchAdmin(`/api/runs/${runId}/cancel`, {
    method: "POST",
  });
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
