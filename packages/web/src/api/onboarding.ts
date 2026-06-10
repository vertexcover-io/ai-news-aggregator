import type { SourceRow, SourceType } from "@newsletter/shared";
import { apiFetch } from "./client";

export interface OnboardingProgress {
  furthestStep: number;
  data: Record<string, unknown>;
}

export interface PatchStepInput {
  furthestStep: number;
  data: Record<string, unknown>;
}

export type SlugStatus = "available" | "taken" | "invalid";

export interface GeneratedPrompts {
  rankingPrompt: string;
  shortlistPrompt: string;
}

export interface SourceCandidate {
  type: SourceType;
  name: string;
  config: Record<string, unknown>;
}

export interface UploadLogoResult {
  ok: true;
  logoContentType: string;
  logoVersion: number;
}

export interface ActivateResult {
  ok: true;
  status: string;
}

export class ActivationIncompleteError extends Error {
  readonly missing: string[];
  constructor(missing: string[]) {
    super("incomplete");
    this.name = "ActivationIncompleteError";
    this.missing = missing;
  }
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? fallback;
}

export async function getProgress(): Promise<OnboardingProgress> {
  const res = await apiFetch("/api/onboarding/progress");
  if (!res.ok) throw new Error(await errorMessage(res, "failed to load progress"));
  return (await res.json()) as OnboardingProgress;
}

export async function patchStep(
  input: PatchStepInput,
): Promise<OnboardingProgress> {
  const res = await apiFetch("/api/onboarding/step", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "failed to save step"));
  return (await res.json()) as OnboardingProgress;
}

export async function checkSlug(slug: string): Promise<SlugStatus> {
  const res = await apiFetch(
    `/api/onboarding/slug-check?slug=${encodeURIComponent(slug)}`,
  );
  if (!res.ok) throw new Error(await errorMessage(res, "slug check failed"));
  const body = (await res.json()) as { status: SlugStatus };
  return body.status;
}

export async function generatePrompts(blurb: string): Promise<GeneratedPrompts> {
  const res = await apiFetch("/api/onboarding/generate-prompts", {
    method: "POST",
    body: JSON.stringify({ blurb }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "prompt generation failed"));
  return (await res.json()) as GeneratedPrompts;
}

export async function discoverSources(
  query: string,
): Promise<SourceCandidate[]> {
  const res = await apiFetch(
    `/api/onboarding/discover-sources?q=${encodeURIComponent(query)}`,
  );
  if (!res.ok) throw new Error(await errorMessage(res, "discovery failed"));
  const body = (await res.json()) as { candidates: SourceCandidate[] };
  return body.candidates;
}

export async function uploadLogo(
  contentType: string,
  base64Data: string,
): Promise<UploadLogoResult> {
  const res = await apiFetch("/api/onboarding/logo", {
    method: "POST",
    body: JSON.stringify({ contentType, data: base64Data }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "logo upload failed"));
  return (await res.json()) as UploadLogoResult;
}

export async function activate(): Promise<ActivateResult> {
  const res = await apiFetch("/api/onboarding/activate", { method: "POST" });
  if (res.status === 422) {
    const body = (await res.json().catch(() => ({}))) as { missing?: string[] };
    throw new ActivationIncompleteError(body.missing ?? []);
  }
  if (!res.ok) throw new Error(await errorMessage(res, "activation failed"));
  return (await res.json()) as ActivateResult;
}

export type { SourceRow };
