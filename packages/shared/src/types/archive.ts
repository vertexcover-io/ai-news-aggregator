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
  /** User role: "super_admin" or "tenant_admin". */
  role: string;
  /** Phase 6: when a super_admin is impersonating, this is true. */
  impersonating?: boolean;
  /** Phase 6: tenant name being impersonated, present when impersonating=true. */
  impersonatingTenantName?: string;
}

/** Phase 3: real auth responses */
export interface SignupResponse {
  next: "onboarding";
  userId: string;
  tenantId: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  ok: boolean;
  userId: string;
  tenantId: string | null;
  role: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  password: string;
  confirmPassword: string;
}

export interface SessionMeResponse {
  authenticated: boolean;
  userId?: string;
  tenantId?: string;
  role?: string;
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
