import type { OnboardingState } from "@newsletter/shared/types";

export interface OnboardingPayload {
  name: string;
  slug: string;
  headline: string | null;
  topicStrip: string | null;
  subtagline: string | null;
  status: string;
  onboardingState: OnboardingState | null;
}

export interface SlugAvailableResult {
  available: boolean;
  reason?: string;
}

export interface GeneratePromptsResult {
  ranking: string;
  shortlist: string;
}

export interface DiscoverSourcesResult {
  candidates: string[];
}

export interface ActivateResult {
  active: boolean;
}

export interface ActivateError {
  error: string;
  missing: string[];
}

export async function getOnboarding(): Promise<OnboardingPayload> {
  const res = await fetch("/api/onboarding", { credentials: "same-origin" });
  if (!res.ok) throw new Error("Failed to load onboarding state");
  return res.json() as Promise<OnboardingPayload>;
}

export async function patchOnboarding(body: Record<string, unknown>): Promise<OnboardingPayload> {
  const res = await fetch("/api/onboarding", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Failed to save onboarding state");
  return res.json() as Promise<OnboardingPayload>;
}

export async function checkSlugAvailable(slug: string): Promise<SlugAvailableResult> {
  const res = await fetch(`/api/onboarding/slug-available?slug=${encodeURIComponent(slug)}`, {
    credentials: "same-origin",
  });
  if (!res.ok) throw new Error("Failed to check slug availability");
  return res.json() as Promise<SlugAvailableResult>;
}

export async function generatePrompts(blurb: string): Promise<GeneratePromptsResult> {
  const res = await fetch("/api/onboarding/generate-prompts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ blurb }),
  });
  if (!res.ok) throw new Error("Failed to generate prompts");
  return res.json() as Promise<GeneratePromptsResult>;
}

export async function discoverSources(blurb: string): Promise<DiscoverSourcesResult> {
  const res = await fetch("/api/onboarding/discover-sources", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ blurb }),
  });
  if (!res.ok) throw new Error("Failed to discover sources");
  return res.json() as Promise<DiscoverSourcesResult>;
}

export async function activateTenant(): Promise<ActivateResult> {
  const res = await fetch("/api/onboarding/activate", {
    method: "POST",
    credentials: "same-origin",
  });
  if (!res.ok) {
    const err = await res.json() as ActivateError;
    throw new Error(JSON.stringify(err));
  }
  return res.json() as Promise<ActivateResult>;
}
