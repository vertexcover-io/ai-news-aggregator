/**
 * Onboarding wizard API client (P11). All HTTP via the shared wrappers
 * (S-web-02); the AI-backed endpoints (generate-prompts, discover-sources)
 * are plain POSTs here — stubbing happens server-side in tests, never with
 * a real Anthropic/Tavily call.
 */
import type {
  ActivateBlockedResponse,
  DiscoverSourcesResponse,
  GeneratePromptsResponse,
  OnboardingState,
  OnboardingStateResponse,
  SlugAvailableResponse,
} from "@newsletter/shared/types/tenant";
import { apiFetchAdmin } from "./client";

interface ApiErrorBody {
  error?: string;
}

async function parseError(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
  throw new Error(body.error ?? `${fallback}: ${String(res.status)}`);
}

export async function getOnboarding(): Promise<OnboardingStateResponse> {
  const res = await apiFetchAdmin("/api/onboarding");
  if (!res.ok) await parseError(res, "Failed to load onboarding state");
  return (await res.json()) as OnboardingStateResponse;
}

export type OnboardingPatch = Partial<
  Pick<OnboardingState, "currentStep" | "completedSteps" | "data">
>;

export async function patchOnboarding(
  patch: OnboardingPatch,
): Promise<{ state: OnboardingState }> {
  const res = await apiFetchAdmin("/api/onboarding", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  if (!res.ok) await parseError(res, "Failed to save progress");
  return (await res.json()) as { state: OnboardingState };
}

export async function checkSlugAvailable(
  slug: string,
): Promise<SlugAvailableResponse> {
  const res = await apiFetchAdmin(
    `/api/onboarding/slug-available?slug=${encodeURIComponent(slug)}`,
  );
  if (!res.ok) await parseError(res, "Failed to check slug");
  return (await res.json()) as SlugAvailableResponse;
}

export async function generatePrompts(
  blurb: string,
): Promise<GeneratePromptsResponse> {
  const res = await apiFetchAdmin("/api/onboarding/generate-prompts", {
    method: "POST",
    body: JSON.stringify({ blurb }),
  });
  if (!res.ok) await parseError(res, "Prompt generation failed");
  return (await res.json()) as GeneratePromptsResponse;
}

export async function discoverSources(
  blurb: string,
): Promise<DiscoverSourcesResponse> {
  const res = await apiFetchAdmin("/api/onboarding/discover-sources", {
    method: "POST",
    body: JSON.stringify({ blurb }),
  });
  if (!res.ok) await parseError(res, "Source discovery failed");
  return (await res.json()) as DiscoverSourcesResponse;
}

/** Raw-bytes upload; the API sniffs the type and rejects bad files (REQ-039). */
export async function uploadLogo(
  file: Blob,
): Promise<{ ok: true; contentType: string }> {
  // apiFetch forces a JSON content-type header; logo upload sends raw bytes,
  // so it uses fetch directly with credentials — the one deliberate
  // exception, mirroring api/eval.ts (S-web-02 documented carve-out).
  const res = await fetch("/api/onboarding/logo", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/octet-stream" },
    body: file,
  });
  if (!res.ok) await parseError(res, "Logo upload failed");
  return (await res.json()) as { ok: true; contentType: string };
}

export class ActivationBlockedError extends Error {
  readonly blocked: ActivateBlockedResponse;

  constructor(blocked: ActivateBlockedResponse) {
    super(`activation blocked: ${blocked.error}`);
    this.name = "ActivationBlockedError";
    this.blocked = blocked;
  }
}

export async function activateOnboarding(): Promise<{
  ok: true;
  slug: string;
}> {
  const res = await apiFetchAdmin("/api/onboarding/activate", {
    method: "POST",
  });
  if (res.status === 409) {
    throw new ActivationBlockedError(
      (await res.json()) as ActivateBlockedResponse,
    );
  }
  if (!res.ok) await parseError(res, "Activation failed");
  return (await res.json()) as { ok: true; slug: string };
}
