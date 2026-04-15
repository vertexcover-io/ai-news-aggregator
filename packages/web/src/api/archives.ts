import type { RankedItem } from "@newsletter/shared";
import { apiFetch } from "./client";

export interface PatchArchiveBody {
  rankedItems: {
    id: number;
    sourceType: string;
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

export async function patchArchive(
  runId: string,
  body: PatchArchiveBody,
): Promise<void> {
  const res = await apiFetch(`/api/archives/${runId}`, {
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
  const res = await apiFetch(`/api/archives/${runId}/add-post`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(data.error ?? "Failed to add post");
  }
  return (await res.json()) as RankedItem;
}
