import type {
  ManualSourceType,
  SourcesSummaryResponse,
  TenantSourceWire,
} from "@newsletter/shared/types";
import { apiFetch, apiFetchAdmin } from "./client";

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

// ---------------------------------------------------------------------------
// Tenant source management (P8, REQ-070/072) — auth-gated /api/sources CRUD.
// ---------------------------------------------------------------------------

async function parseError(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
  throw new Error(body.error ?? `${fallback}: ${String(res.status)}`);
}

export async function fetchTenantSources(): Promise<TenantSourceWire[]> {
  const res = await apiFetchAdmin("/api/sources");
  if (!res.ok) await parseError(res, "Failed to load sources");
  const body = (await res.json()) as { sources: TenantSourceWire[] };
  return body.sources;
}

export async function addTenantSource(input: {
  type: ManualSourceType;
  value: string;
}): Promise<TenantSourceWire> {
  const res = await apiFetchAdmin("/api/sources", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) await parseError(res, "Failed to add source");
  return (await res.json()) as TenantSourceWire;
}

export async function setTenantSourceEnabled(
  id: string,
  enabled: boolean,
): Promise<TenantSourceWire> {
  const res = await apiFetchAdmin(`/api/sources/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) await parseError(res, "Failed to update source");
  return (await res.json()) as TenantSourceWire;
}

export async function removeTenantSource(id: string): Promise<void> {
  const res = await apiFetchAdmin(`/api/sources/${id}`, { method: "DELETE" });
  if (!res.ok) await parseError(res, "Failed to remove source");
}
