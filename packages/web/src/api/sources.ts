import type { SourcesSummaryResponse } from "@newsletter/shared/types";
import { apiFetch } from "./client";

interface ApiErrorBody {
  error?: string;
}

export async function fetchSourcesSummary(): Promise<SourcesSummaryResponse> {
  const res = await apiFetch("/api/sources/summary");
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(body.error ?? `Failed to fetch sources summary: ${String(res.status)}`);
  }
  return (await res.json()) as SourcesSummaryResponse;
}
