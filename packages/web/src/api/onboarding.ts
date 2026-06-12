import { apiFetchAdmin } from "./client";

export const ONBOARDING_STEP_ORDER = [
  "name",
  "slug",
  "logo",
  "homepage",
  "prompts",
  "channels",
  "sources",
  "schedule",
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEP_ORDER)[number];

export interface OnboardingProgress {
  furthestStep: number;
  completed: string[];
  description?: string;
}

export interface OnboardingTenant {
  id: string;
  name: string;
  slug: string;
  status: "pending_setup" | "active";
  headline: string | null;
  topicStrip: string | null;
  subtagline: string | null;
  logoVersion: number;
}

export interface OnboardingSchedule {
  pipelineTime: string;
  emailTime: string;
  timezone: string;
  emailEnabled: boolean;
  linkedinEnabled: boolean;
  twitterPostEnabled: boolean;
}

export interface OnboardingState {
  tenant: OnboardingTenant;
  onboarding: OnboardingProgress;
  prompts: { rankingPrompt: string; shortlistPrompt: string } | null;
  schedule: OnboardingSchedule | null;
  enabledSourceCount: number;
}

export type SlugCheckStatus = "available" | "taken" | "invalid" | "reserved";

export interface GeneratedPrompts {
  rankingPrompt: string;
  shortlistPrompt: string;
}

export type OnboardingStepPayload =
  | { step: "name"; data: { name: string } }
  | { step: "slug"; data: { slug: string } }
  | { step: "logo" }
  | {
      step: "homepage";
      data: { headline: string; topicStrip?: string; subtagline?: string | null };
    }
  | {
      step: "prompts";
      data: { rankingPrompt: string; shortlistPrompt: string; description?: string };
    }
  | { step: "channels" }
  | { step: "sources" }
  | {
      step: "schedule";
      data: { pipelineTime: string; emailTime: string; timezone: string };
    };

export class OnboardingApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "OnboardingApiError";
    this.status = status;
  }
}

export class SlugTakenError extends OnboardingApiError {
  constructor() {
    super("slug taken", 409);
    this.name = "SlugTakenError";
  }
}

export class OnboardingIncompleteError extends OnboardingApiError {
  readonly missing: OnboardingStepId[];
  constructor(missing: OnboardingStepId[]) {
    super("onboarding incomplete", 422);
    this.name = "OnboardingIncompleteError";
    this.missing = missing;
  }
}

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new OnboardingApiError(body.error ?? fallback, res.status);
  }
  return (await res.json()) as T;
}

export async function getOnboardingState(): Promise<OnboardingState> {
  const res = await apiFetchAdmin("/api/admin/onboarding/state");
  return readJson(res, "Failed to load onboarding state");
}

export async function patchOnboardingStep(
  payload: OnboardingStepPayload,
): Promise<{ onboarding: OnboardingProgress; tenant: OnboardingTenant }> {
  const res = await apiFetchAdmin("/api/admin/onboarding/state", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  if (res.status === 409) throw new SlugTakenError();
  return readJson(res, "Failed to save step");
}

export async function checkSlug(slug: string): Promise<SlugCheckStatus> {
  const res = await apiFetchAdmin(
    `/api/admin/onboarding/slug-check?slug=${encodeURIComponent(slug)}`,
  );
  const body = await readJson<{ status: SlugCheckStatus }>(
    res,
    "Slug check failed",
  );
  return body.status;
}

export async function generatePrompts(
  description: string,
): Promise<GeneratedPrompts> {
  const res = await apiFetchAdmin("/api/admin/onboarding/generate-prompts", {
    method: "POST",
    body: JSON.stringify({ description }),
  });
  return readJson(res, "Prompt generation failed");
}

export async function activateOnboarding(): Promise<{ status: "active" }> {
  const res = await apiFetchAdmin("/api/admin/onboarding/activate", {
    method: "POST",
  });
  if (res.status === 422) {
    const body = (await res.json().catch(() => ({}))) as {
      missing?: OnboardingStepId[];
    };
    throw new OnboardingIncompleteError(body.missing ?? []);
  }
  return readJson(res, "Activation failed");
}

// ── Reused Phase 10 endpoint: logo upload ────────────────────────────────────

export async function uploadLogo(file: File): Promise<{ logoVersion: number }> {
  const form = new FormData();
  form.append("logo", file);
  const res = await fetch("/api/admin/branding/logo", {
    method: "PUT",
    credentials: "include",
    body: form,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { reason?: string };
    throw new OnboardingApiError(
      body.reason ?? "Logo upload failed",
      res.status,
    );
  }
  return (await res.json()) as { logoVersion: number };
}

// ── Reused Phase 5 endpoints: tenant sources CRUD + discovery ────────────────

export type AdminSourceConfig =
  | { kind: "hn"; sinceDays: number }
  | { kind: "reddit"; subreddit: string; sinceDays: number }
  | { kind: "web"; name: string; listingUrl: string };

export interface AdminSource {
  id: string;
  type: "hn" | "reddit" | "web" | "twitter" | "web_search";
  config: Record<string, unknown>;
  enabled: boolean;
}

export interface SourceCandidate {
  type: AdminSource["type"];
  title: string;
  url: string;
  description: string;
}

export async function listAdminSources(): Promise<AdminSource[]> {
  const res = await apiFetchAdmin("/api/admin/sources");
  const body = await readJson<{ sources: AdminSource[] }>(
    res,
    "Failed to load sources",
  );
  return body.sources;
}

export async function createAdminSource(input: {
  type: AdminSource["type"];
  config: Record<string, unknown>;
}): Promise<AdminSource> {
  const res = await apiFetchAdmin("/api/admin/sources", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return readJson(res, "Failed to add source");
}

export async function deleteAdminSource(id: string): Promise<void> {
  const res = await apiFetchAdmin(`/api/admin/sources/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new OnboardingApiError("Failed to remove source", res.status);
}

export async function discoverSources(
  topic: string,
): Promise<SourceCandidate[]> {
  const res = await apiFetchAdmin("/api/admin/sources/discover", {
    method: "POST",
    body: JSON.stringify({ topic }),
  });
  const body = await readJson<{ candidates: SourceCandidate[] }>(
    res,
    "Source discovery failed",
  );
  return body.candidates;
}

// ── Reused Phase 8 endpoint: Twitter OAuth start/status ──────────────────────

export interface TwitterOAuthStatus {
  clientConfigured: boolean;
  connected: boolean;
  connectedAs: string | null;
}

export async function startTwitterOAuth(): Promise<{ authorizeUrl: string }> {
  const res = await apiFetchAdmin(
    "/api/admin/social-credentials/twitter/oauth/start",
    { method: "POST" },
  );
  return readJson(res, "Failed to start Twitter OAuth");
}

export async function getTwitterOAuthStatus(): Promise<TwitterOAuthStatus> {
  const res = await apiFetchAdmin(
    "/api/admin/social-credentials/twitter/oauth/status",
  );
  return readJson(res, "Failed to load Twitter status");
}

// ── Reused Phase 7 endpoints: sending domain ─────────────────────────────────

export interface SendingDomainState {
  domain: string;
  status: "pending" | "verified" | "failed";
  dnsRecords: { record?: string; name?: string; type?: string; value?: string }[];
  failureReason: string | null;
}

export async function getSendingDomain(): Promise<SendingDomainState | null> {
  const res = await apiFetchAdmin("/api/admin/sending-domain");
  const body = await readJson<{ sendingDomain: SendingDomainState | null }>(
    res,
    "Failed to load sending domain",
  );
  return body.sendingDomain;
}

export async function registerSendingDomain(
  domain: string,
): Promise<SendingDomainState> {
  const res = await apiFetchAdmin("/api/admin/sending-domain", {
    method: "POST",
    body: JSON.stringify({ domain }),
  });
  const body = await readJson<{ sendingDomain: SendingDomainState }>(
    res,
    "Failed to register domain",
  );
  return body.sendingDomain;
}

export async function verifySendingDomain(): Promise<SendingDomainState> {
  const res = await apiFetchAdmin("/api/admin/sending-domain/verify", {
    method: "POST",
  });
  const body = await readJson<{ sendingDomain: SendingDomainState }>(
    res,
    "Verification check failed",
  );
  return body.sendingDomain;
}
