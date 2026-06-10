import { apiFetchAdmin } from "./client";

export interface AdminSource {
  id: string;
  tenantId: string;
  type: string;
  config: Record<string, unknown> | null;
  enabled: boolean;
  lastHealth: {
    lastCheckAt?: string;
    status?: "healthy" | "degraded" | "failed";
    message?: string;
    itemsFetched?: number;
    durationMs?: number;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSourceInput {
  type: string;
  config?: Record<string, unknown> | null;
  enabled?: boolean;
}

export interface PatchSourceInput {
  config?: Record<string, unknown> | null;
  enabled?: boolean;
}

export async function getAdminSources(): Promise<AdminSource[]> {
  const res = await apiFetchAdmin("/api/admin/sources");
  if (!res.ok) throw new Error("Failed to fetch sources");
  return (await res.json()) as AdminSource[];
}

export async function createAdminSource(input: CreateSourceInput): Promise<AdminSource> {
  const res = await apiFetchAdmin("/api/admin/sources", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to create source");
  }
  return (await res.json()) as AdminSource;
}

export async function patchAdminSource(id: string, input: PatchSourceInput): Promise<AdminSource> {
  const res = await apiFetchAdmin(`/api/admin/sources/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to update source");
  }
  return (await res.json()) as AdminSource;
}

export async function deleteAdminSource(id: string): Promise<void> {
  const res = await apiFetchAdmin(`/api/admin/sources/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to delete source");
  }
}
