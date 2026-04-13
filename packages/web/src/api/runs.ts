import type {
  RankedItem,
  RunState,
  RunSubmitPayload,
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
