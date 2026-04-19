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
