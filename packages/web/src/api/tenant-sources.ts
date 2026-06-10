import type { SourceRow, SourceType } from "@newsletter/shared";
import { apiFetch } from "./client";

export interface AddSourceInput {
  type: SourceType;
  config: Record<string, unknown>;
  enabled?: boolean;
}

export interface DiscoveredSource {
  type: SourceType;
  title: string;
  url: string;
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? fallback;
}

export async function listSources(): Promise<SourceRow[]> {
  const res = await apiFetch("/api/tenant-sources");
  if (!res.ok) throw new Error(await errorMessage(res, "failed to load sources"));
  return (await res.json()) as SourceRow[];
}

export async function addSource(input: AddSourceInput): Promise<SourceRow> {
  const res = await apiFetch("/api/tenant-sources", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "failed to add source"));
  return (await res.json()) as SourceRow;
}

export async function setSourceEnabled(
  id: string,
  enabled: boolean,
): Promise<SourceRow> {
  const res = await apiFetch(`/api/tenant-sources/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "failed to update source"));
  return (await res.json()) as SourceRow;
}

export async function removeSource(id: string): Promise<void> {
  const res = await apiFetch(`/api/tenant-sources/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await errorMessage(res, "failed to remove source"));
}

export async function discover(
  query: string,
  type?: SourceType,
): Promise<DiscoveredSource[]> {
  const params = new URLSearchParams({ query });
  if (type) params.set("type", type);
  const res = await apiFetch(`/api/tenant-sources/discover?${params.toString()}`);
  if (!res.ok) throw new Error(await errorMessage(res, "discovery failed"));
  const body = (await res.json()) as { candidates: DiscoveredSource[] };
  return body.candidates;
}
