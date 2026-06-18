/**
 * Wizard step metadata + the client-side mirror of the activation gate
 * (P11, REQ-025/032/038). The API's missingRequiredSteps stays authoritative
 * — this mirror only drives the disabled state / hint list in the UI.
 */
import {
  isReservedTenantSlug,
  isValidTenantSlugFormat,
} from "@newsletter/shared/constants/tenant";
import type {
  OnboardingData,
  OnboardingRequiredStep,
} from "@newsletter/shared/types/tenant";

export type WizardStepKey =
  | "name"
  | "slug"
  | "logo"
  | "homepage"
  | "prompts"
  | "social"
  | "sources"
  | "schedule";

export interface WizardStepDef {
  key: WizardStepKey;
  railLabel: string;
  tag: string;
}

export const WIZARD_STEPS: readonly WizardStepDef[] = [
  { key: "name", railLabel: "Newsletter name", tag: "Required" },
  { key: "slug", railLabel: "Subdomain", tag: "Required" },
  { key: "logo", railLabel: "Logo", tag: "Optional" },
  { key: "homepage", railLabel: "Homepage text", tag: "Required" },
  { key: "prompts", railLabel: "Prompts", tag: "Required" },
  { key: "social", railLabel: "Social & email", tag: "Optional" },
  { key: "sources", railLabel: "Sources", tag: "Required · ≥1" },
  { key: "schedule", railLabel: "Schedule", tag: "Required" },
];

/** Contract every step form receives from the wizard page. */
export interface StepProps {
  data: OnboardingData;
  update: (patch: Partial<OnboardingData>) => void;
}

export function stepIndexForKey(key: string | undefined): number {
  const index = WIZARD_STEPS.findIndex((step) => step.key === key);
  return index === -1 ? 0 : index;
}

const hasText = (value: string | undefined): boolean =>
  value !== undefined && value.trim().length > 0;

function hasValidSlug(slug: string | undefined): boolean {
  if (slug === undefined || !hasText(slug)) return false;
  const normalized = slug.trim().toLowerCase();
  return isValidTenantSlugFormat(normalized) && !isReservedTenantSlug(normalized);
}

/** Mirror of the API gate (services/onboarding.ts missingRequiredSteps). */
export function localMissingSteps(
  data: OnboardingData,
  sourcesCount: number,
): OnboardingRequiredStep[] {
  const missing: OnboardingRequiredStep[] = [];
  if (!hasText(data.name)) missing.push("name");
  if (!hasValidSlug(data.slug)) missing.push("slug");
  if (!hasText(data.headline)) missing.push("headline");
  if (!hasText(data.rankingPrompt) || !hasText(data.shortlistPrompt)) {
    missing.push("prompts");
  }
  if (sourcesCount < 1) missing.push("sources");
  if (
    !hasText(data.pipelineTime) ||
    !hasText(data.emailTime) ||
    !hasText(data.timezone)
  ) {
    missing.push("schedule");
  }
  return missing;
}

/** Human label for a missing required step (REQ-038 hint list). */
export const MISSING_STEP_LABELS: Record<OnboardingRequiredStep, string> = {
  name: "Newsletter name",
  slug: "Subdomain",
  headline: "Homepage text",
  prompts: "Prompts",
  sources: "Sources (add at least one)",
  schedule: "Schedule",
};

/**
 * Map the sources step's single "Add manually" input to a manual-add
 * type+value pair (the Settings panel has a type selector; the wizard
 * infers it from the shape of the input, per the mock's one-field UX).
 */
export function inferManualSource(raw: string): {
  type: "twitter" | "reddit" | "rss";
  value: string;
} {
  const value = raw.trim();
  const lower = value.toLowerCase();
  if (value.startsWith("@")) return { type: "twitter", value };
  if (lower.startsWith("r/") || lower.startsWith("/r/")) {
    return { type: "reddit", value };
  }
  // FIX #5: HN is no longer addable from the one-field manual input — it needs
  // keywords, configured via the Settings panel after onboarding.
  const hasScheme = lower.startsWith("http://") || lower.startsWith("https://");
  if (hasScheme || value.includes(".")) {
    return { type: "rss", value: hasScheme ? value : `https://${value}` };
  }
  return { type: "reddit", value };
}

/** Where the wizard suffixes slugs for display (`<slug>.<root>`). */
export const PUBLIC_ROOT_DOMAIN: string =
  (import.meta.env.VITE_PUBLIC_ROOT_DOMAIN as string | undefined) ??
  "ourdomain.com";

/**
 * Shared, pre-verified sending domain for the managed-default sender (Fix #3).
 * A new tenant sends from `<slug>@<MANAGED_EMAIL_DOMAIN>` with zero config; they
 * can bring their own sending domain or SMTP provider later in Settings.
 */
export const MANAGED_EMAIL_DOMAIN: string =
  (import.meta.env.VITE_MANAGED_EMAIL_DOMAIN as string | undefined) ??
  "news.vertexcover.io";

/** The managed-default broadcast sender for a given slug. */
export function managedSenderFor(slug: string): string {
  return `${slug}@${MANAGED_EMAIL_DOMAIN}`;
}
