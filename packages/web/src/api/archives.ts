import type {
  RankedItem,
  PoolResponse,
  ArchiveListResponse,
} from "@newsletter/shared";
import { apiFetch, apiFetchAdmin } from "./client";

export interface PatchArchiveBody {
  rankedItems: {
    id: number;
    sourceType: string;
    title?: string;
    summary?: string;
    bullets?: string[];
    bottomLine?: string;
    imageUrl?: string | null;
  }[];
}

export interface AddPostBody {
  url: string;
}

interface ApiErrorBody {
  error?: string;
}

export async function listArchives(): Promise<ArchiveListResponse> {
  const res = await apiFetch("/api/archives");
  if (!res.ok) throw new Error(`listArchives: ${String(res.status)}`);
  return (await res.json()) as ArchiveListResponse;
}

export interface SearchArchivesQuery {
  q?: string;
  from?: string;
  to?: string;
}

export async function searchArchives(
  query: SearchArchivesQuery = {},
): Promise<ArchiveListResponse> {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  const qs = params.toString();
  const url = `/api/archives/search${qs ? `?${qs}` : ""}`;
  const res = await apiFetch(url);
  if (!res.ok) throw new Error(`searchArchives: ${String(res.status)}`);
  return (await res.json()) as ArchiveListResponse;
}

export async function deleteArchive(runId: string): Promise<void> {
  const res = await apiFetchAdmin(`/api/admin/archives/${runId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(data.error ?? `Failed to delete archive: ${String(res.status)}`);
  }
}

export async function patchArchive(
  runId: string,
  body: PatchArchiveBody,
): Promise<void> {
  const res = await apiFetchAdmin(`/api/admin/archives/${runId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(data.error ?? "Failed to save archive");
  }
}

export async function addPost(
  runId: string,
  body: AddPostBody,
): Promise<RankedItem> {
  const res = await apiFetchAdmin(`/api/admin/archives/${runId}/add-post`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(data.error ?? "Failed to add post");
  }
  return (await res.json()) as RankedItem;
}

export interface PoolQuery {
  sort?: "engagement" | "recency";
  source?: string;
  sources?: string[];
  shortlisted?: boolean;
  q?: string;
  offset?: number;
  limit?: number;
}

export async function getPool(
  runId: string,
  query: PoolQuery = {},
): Promise<PoolResponse> {
  const params = new URLSearchParams();
  if (query.sort) params.set("sort", query.sort);
  if (query.source) params.set("source", query.source);
  if (query.sources && query.sources.length > 0) {
    for (const s of query.sources) params.append("sources", s);
  }
  if (query.shortlisted) params.set("shortlisted", "true");
  if (query.q) params.set("q", query.q);
  if (query.offset !== undefined) params.set("offset", String(query.offset));
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  const qs = params.toString();
  const url = `/api/admin/archives/${runId}/pool${qs ? `?${qs}` : ""}`;
  const res = await apiFetchAdmin(url);
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(data.error ?? "Failed to fetch pool");
  }
  return (await res.json()) as PoolResponse;
}

export interface PromoteBody {
  rawItemId: number;
}

export async function promoteItem(
  runId: string,
  body: PromoteBody,
): Promise<RankedItem> {
  const res = await apiFetchAdmin(`/api/admin/archives/${runId}/promote`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(data.error ?? "Failed to promote item");
  }
  return (await res.json()) as RankedItem;
}

export interface SourceFacetEntry {
  sourceIdentifier: string;
  displayName: string;
  count: number;
}

export interface SourceFacetGroupRaw {
  sourceType: string;
  facets: SourceFacetEntry[];
}

interface SourceFacetFlat {
  sourceType: string;
  identifier: string;
  displayName: string;
  count: number;
}

export async function getSourceFacets(
  runId: string,
): Promise<SourceFacetGroupRaw[]> {
  const res = await apiFetchAdmin(
    `/api/admin/archives/${runId}/source-facets`,
  );
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(data.error ?? "Failed to fetch source facets");
  }
  const body = (await res.json()) as { facets: SourceFacetFlat[] };
  // Group flat {sourceType, identifier, displayName, count} into SourceFacetGroupRaw[]
  const grouped = new Map<string, SourceFacetEntry[]>();
  for (const f of body.facets) {
    const entries = grouped.get(f.sourceType) ?? [];
    entries.push({
      sourceIdentifier: f.identifier,
      displayName: f.displayName,
      count: f.count,
    });
    grouped.set(f.sourceType, entries);
  }
  return Array.from(grouped.entries()).map(([sourceType, facets]) => ({
    sourceType,
    facets,
  }));
}
