import type {
  AdminMustReadEntry,
  MustReadCreateBody,
  MustReadPatchBody,
  MustReadPreviewResponse,
  PublicMustReadEntry,
} from "@newsletter/shared/types";
import { apiFetch, apiFetchAdmin } from "./client";

export async function listMustRead(): Promise<PublicMustReadEntry[]> {
  const res = await apiFetch("/api/must-read");
  if (!res.ok) throw new Error(`listMustRead: ${String(res.status)}`);
  return (await res.json()) as PublicMustReadEntry[];
}

export class DuplicateUrlError extends Error {
  existingId: string;
  constructor(existingId: string) {
    super("URL already exists");
    this.name = "DuplicateUrlError";
    this.existingId = existingId;
  }
}

interface ApiErrorBody {
  error?: string;
  existingId?: string;
}

async function readError(res: Response): Promise<ApiErrorBody> {
  return (await res.json().catch(() => ({}))) as ApiErrorBody;
}

export async function previewMustRead(input: {
  url: string;
}): Promise<MustReadPreviewResponse> {
  const res = await apiFetchAdmin("/api/admin/must-read/preview", {
    method: "POST",
    body: JSON.stringify({ url: input.url }),
  });
  if (!res.ok) {
    const data = await readError(res);
    throw new Error(data.error ?? `previewMustRead: ${String(res.status)}`);
  }
  return (await res.json()) as MustReadPreviewResponse;
}

export async function createMustRead(
  input: MustReadCreateBody,
): Promise<AdminMustReadEntry> {
  const res = await apiFetchAdmin("/api/admin/must-read", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (res.status === 409) {
    const data = await readError(res);
    throw new DuplicateUrlError(data.existingId ?? "");
  }
  if (!res.ok) {
    const data = await readError(res);
    throw new Error(data.error ?? `createMustRead: ${String(res.status)}`);
  }
  return (await res.json()) as AdminMustReadEntry;
}

export async function listAdminMustRead(): Promise<AdminMustReadEntry[]> {
  const res = await apiFetchAdmin("/api/admin/must-read");
  if (!res.ok) throw new Error(`listAdminMustRead: ${String(res.status)}`);
  return (await res.json()) as AdminMustReadEntry[];
}

export async function updateMustRead(
  id: string,
  patch: MustReadPatchBody,
): Promise<AdminMustReadEntry> {
  const res = await apiFetchAdmin(`/api/admin/must-read/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  if (res.status === 409) {
    const data = await readError(res);
    throw new DuplicateUrlError(data.existingId ?? "");
  }
  if (!res.ok) {
    const data = await readError(res);
    throw new Error(data.error ?? `updateMustRead: ${String(res.status)}`);
  }
  return (await res.json()) as AdminMustReadEntry;
}

export async function deleteMustRead(id: string): Promise<void> {
  const res = await apiFetchAdmin(`/api/admin/must-read/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const data = await readError(res);
    throw new Error(data.error ?? `deleteMustRead: ${String(res.status)}`);
  }
}
