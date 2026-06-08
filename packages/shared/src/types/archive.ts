import type { SourceType } from "../db/schema.js";

export interface ArchiveTopItem {
  id: number;
  title: string;
  sourceType: SourceType;
}

export interface ArchiveListItem {
  runId: string;
  runDate: string;
  storyCount: number;
  topItems: ArchiveTopItem[];
  leadSummary: string | null;
  digestHeadline: string | null;
  digestSummary: string | null;
  isDryRun: boolean;
}

export interface ArchiveListResponse {
  archives: ArchiveListItem[];
}

export interface AdminLoginRequest {
  password: string;
}

export interface AdminLoginResponse {
  ok: true;
}

export interface AdminMeResponse {
  admin: true;
}

/** Shared shape for the curated ranked-items patch payload — used by both the
 * API server (as the parsed request body) and the web client (as the request
 * body type sent to PATCH /api/admin/archives/:runId). */
export interface PatchArchivePayload {
  rankedItems: {
    id: number;
    sourceType: string;
    title?: string;
    summary?: string;
    bullets?: string[];
    bottomLine?: string;
    imageUrl?: string | null;
  }[];
  digestHeadline?: string | null;
  digestSummary?: string | null;
  hook?: string | null;
  twitterSummary?: string | null;
  linkedinPostBody?: string | null;
  /** When false, persists edits as a draft without publishing (reviewed stays
   * false, no channels enqueued). Absent means true (backward-compatible). */
  publish?: boolean;
}
