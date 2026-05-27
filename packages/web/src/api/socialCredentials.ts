import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { apiFetchAdmin } from "./client";

export type Platform = "linkedin" | "twitter" | "twitter-collector";

export interface LinkedInStatus {
  configured: boolean;
  apiVersion: string | null;
  updatedAt: string | null;
}

export interface TwitterStatus {
  configured: boolean;
  updatedAt: string | null;
}

export interface TwitterCollectorStatus {
  configured: boolean;
  updatedAt: string | null;
}

export interface SocialCredentialsStatus {
  linkedin: LinkedInStatus;
  twitter: TwitterStatus;
  twitterCollector: TwitterCollectorStatus;
}

export interface LinkedInUpsertInput {
  clientId: string;
  clientSecret: string;
  apiVersion?: string;
}

export interface TwitterUpsertInput {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

export interface TwitterCollectorUpsertInput {
  apiKey: string;
}

export interface UpsertResult {
  ok: boolean;
  configured: boolean;
  updatedAt: string;
}

const STATUS_QUERY_KEY = ["social-credentials"] as const;

interface ApiErrorBody {
  error?: string;
  issues?: unknown;
}

export class SocialCredentialsApiError extends Error {
  readonly status: number;
  readonly issues: unknown;

  constructor(message: string, status: number, issues: unknown) {
    super(message);
    this.name = "SocialCredentialsApiError";
    this.status = status;
    this.issues = issues;
  }
}

async function readError(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
  throw new SocialCredentialsApiError(
    body.error ?? fallback,
    res.status,
    body.issues,
  );
}

export async function getSocialCredentialsStatus(): Promise<SocialCredentialsStatus> {
  const res = await apiFetchAdmin("/api/admin/social-credentials");
  if (!res.ok) {
    await readError(res, "Failed to fetch social credentials");
  }
  return (await res.json()) as SocialCredentialsStatus;
}

export async function putLinkedInCredentials(
  input: LinkedInUpsertInput,
): Promise<UpsertResult> {
  const res = await apiFetchAdmin("/api/admin/social-credentials/linkedin", {
    method: "PUT",
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    await readError(res, "Failed to save LinkedIn credentials");
  }
  return (await res.json()) as UpsertResult;
}

export async function putTwitterCredentials(
  input: TwitterUpsertInput,
): Promise<UpsertResult> {
  const res = await apiFetchAdmin("/api/admin/social-credentials/twitter", {
    method: "PUT",
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    await readError(res, "Failed to save Twitter credentials");
  }
  return (await res.json()) as UpsertResult;
}

export async function putTwitterCollectorCookie(
  input: TwitterCollectorUpsertInput,
): Promise<UpsertResult> {
  const res = await apiFetchAdmin(
    "/api/admin/social-credentials/twitter-collector",
    {
      method: "PUT",
      body: JSON.stringify(input),
    },
  );
  if (!res.ok) {
    await readError(res, "Failed to save Twitter collector cookies");
  }
  return (await res.json()) as UpsertResult;
}

export async function deleteSocialCredentials(
  platform: Platform,
): Promise<{ ok: boolean; removed: boolean }> {
  const res = await apiFetchAdmin(
    `/api/admin/social-credentials/${platform}`,
    { method: "DELETE" },
  );
  if (!res.ok) {
    await readError(res, "Failed to delete credentials");
  }
  return (await res.json()) as { ok: boolean; removed: boolean };
}

export function useSocialCredentialsStatus(): UseQueryResult<SocialCredentialsStatus> {
  return useQuery<SocialCredentialsStatus>({
    queryKey: STATUS_QUERY_KEY,
    queryFn: getSocialCredentialsStatus,
    refetchOnWindowFocus: false,
  });
}

export function useSaveLinkedInCredentials(): UseMutationResult<
  UpsertResult,
  Error,
  LinkedInUpsertInput
> {
  const qc = useQueryClient();
  return useMutation<UpsertResult, Error, LinkedInUpsertInput>({
    mutationFn: putLinkedInCredentials,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
    },
  });
}

export function useSaveTwitterCredentials(): UseMutationResult<
  UpsertResult,
  Error,
  TwitterUpsertInput
> {
  const qc = useQueryClient();
  return useMutation<UpsertResult, Error, TwitterUpsertInput>({
    mutationFn: putTwitterCredentials,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
    },
  });
}

export function useSaveTwitterCollectorCookie(): UseMutationResult<
  UpsertResult,
  Error,
  TwitterCollectorUpsertInput
> {
  const qc = useQueryClient();
  return useMutation<UpsertResult, Error, TwitterCollectorUpsertInput>({
    mutationFn: putTwitterCollectorCookie,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
    },
  });
}

export function useDeleteSocialCredentials(): UseMutationResult<
  { ok: boolean; removed: boolean },
  Error,
  Platform
> {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean; removed: boolean }, Error, Platform>({
    mutationFn: deleteSocialCredentials,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
    },
  });
}

// ── LinkedIn OAuth status + start ─────────────────────────────────────────────

export interface LinkedInOAuthStatus {
  clientConfigured: boolean;
  connected: boolean;
  connectedAs: string | null;
  expiresAt: string | null;
  hasRefreshToken: boolean;
}

const LINKEDIN_OAUTH_STATUS_KEY = ["linkedin-oauth-status"] as const;

export async function fetchLinkedInOAuthStatus(): Promise<LinkedInOAuthStatus> {
  const res = await apiFetchAdmin(
    "/api/admin/social-credentials/linkedin/oauth/status",
  );
  if (!res.ok) {
    await readError(res, "Failed to fetch LinkedIn OAuth status");
  }
  return (await res.json()) as LinkedInOAuthStatus;
}

export async function startLinkedInOAuth(): Promise<{ authorizeUrl: string }> {
  const res = await apiFetchAdmin(
    "/api/admin/social-credentials/linkedin/oauth/start",
    { method: "POST" },
  );
  if (!res.ok) {
    await readError(res, "Failed to start LinkedIn OAuth");
  }
  return (await res.json()) as { authorizeUrl: string };
}

export function useLinkedInOAuthStatus(): UseQueryResult<LinkedInOAuthStatus> {
  return useQuery<LinkedInOAuthStatus>({
    queryKey: LINKEDIN_OAUTH_STATUS_KEY,
    queryFn: fetchLinkedInOAuthStatus,
    refetchOnWindowFocus: false,
  });
}
