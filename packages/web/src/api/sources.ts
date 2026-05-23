import type { SourcesSummaryResponse } from "@newsletter/shared/types";
import { apiFetch } from "./client";

interface ApiErrorBody {
  error?: string;
}

export interface FetchSourcesSummaryOptions {
  from?: string;
  to?: string;
}

export async function fetchSourcesSummary(
  opts: FetchSourcesSummaryOptions = {},
): Promise<SourcesSummaryResponse> {
  const params = new URLSearchParams();
  if (opts.from) params.set("from", opts.from);
  if (opts.to) params.set("to", opts.to);
  const qs = params.toString();
  const path = `/api/sources/summary${qs.length > 0 ? `?${qs}` : ""}`;
  const res = await apiFetch(path);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(
      body.error ?? `Failed to fetch sources summary: ${String(res.status)}`,
    );
  }
  return (await res.json()) as SourcesSummaryResponse;
}
