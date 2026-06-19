/**
 * Onboarding wizard business logic (P11, REQ-030–038).
 *
 * - `checkSlugAvailability` — slug-availability for the wizard's live check
 *   (REQ-033, EDGE-001/003): format + reserved words (shared P1 constants)
 *   + global uniqueness, with the tenant's own current slug reading as
 *   available (re-checking your own slug is not a conflict).
 * - `missingRequiredSteps` — the activation gate's source of truth
 *   (REQ-025/035/038): name, slug, headline, prompts, ≥1 source, schedule.
 * - `activateTenant` — asserts the gate, applies the collected wizard state
 *   to the real stores (tenant profile + slug + per-tenant settings), flips
 *   status to `active` and reconciles the per-tenant schedulers (REQ-035).
 *   Incomplete state BLOCKS with the missing-step list (REQ-028/038); a
 *   slug uniqueness race surfaces as `slug_taken` (EDGE-001).
 */
import type { Queue } from "bullmq";
import {
  isReservedTenantSlug,
  isValidTenantSlugFormat,
} from "@newsletter/shared/constants/tenant";
import {
  ONBOARDING_REQUIRED_STEPS,
  type ActivateBlockedResponse,
  type OnboardingData,
  type OnboardingRequiredStep,
  type OnboardingState,
  type SlugAvailability,
} from "@newsletter/shared/types/tenant";
import type { TenantRow, TenantsRepo } from "../repositories/tenants.js";
import type {
  UserSettingsRepo,
  UserSettingsUpsertInput,
} from "../repositories/user-settings.js";
import type { SourcesRepo } from "../repositories/sources.js";
import { changeTenantSlug, SlugChangeError } from "./tenant-slug.js";
import {
  reconcileCollectorHealthSchedule,
  reconcilePipelineSchedule,
} from "./scheduler.js";

export interface SlugCheckDeps {
  tenantsRepo: Pick<TenantsRepo, "findBySlug">;
}

export async function checkSlugAvailability(
  deps: SlugCheckDeps,
  rawSlug: string,
  selfTenantId?: string,
): Promise<SlugAvailability> {
  const slug = rawSlug.trim().toLowerCase();
  if (!isValidTenantSlugFormat(slug)) return "invalid";
  if (isReservedTenantSlug(slug)) return "reserved";
  const holder = await deps.tenantsRepo.findBySlug(slug);
  if (holder === null || holder.id === selfTenantId) return "available";
  return "taken";
}

const hasText = (value: string | undefined): boolean =>
  value !== undefined && value.trim().length > 0;

/** True when the slug field holds a valid, non-reserved slug. */
function hasValidSlug(slug: string | undefined): boolean {
  if (!hasText(slug) || slug === undefined) return false;
  const normalized = slug.trim().toLowerCase();
  return isValidTenantSlugFormat(normalized) && !isReservedTenantSlug(normalized);
}

export function missingRequiredSteps(
  state: OnboardingState | null,
  sourcesCount: number,
): OnboardingRequiredStep[] {
  const data: OnboardingData = state?.data ?? {};
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

type SchedulerQueue = Pick<Queue, "upsertJobScheduler" | "removeJobScheduler">;

export interface ActivateDeps {
  tenantsRepo: Pick<
    TenantsRepo,
    "findById" | "findBySlug" | "updateSlug" | "completeOnboarding"
  >;
  sourcesRepo: Pick<SourcesRepo, "list">;
  settingsRepo: Pick<UserSettingsRepo, "upsert">;
  processingQueue: SchedulerQueue;
  collectorHealthQueue: SchedulerQueue;
}

export type ActivateResult =
  | { ok: true; tenant: TenantRow }
  | { ok: false; blocked: ActivateBlockedResponse };

/**
 * Per-tenant settings written at activation. Collector toggles stay off —
 * since P8/P9 the pipeline reads the tenant's `sources` rows, not these
 * legacy flags. Publishing starts with email only; LinkedIn/X connect later
 * (P12/P13 surfaces).
 */
function activationSettings(data: OnboardingData): UserSettingsUpsertInput {
  const pipelineTime = data.pipelineTime ?? "06:00";
  const emailTime = data.emailTime ?? "07:30";
  return {
    topN: 10,
    halfLifeHours: null,
    hnEnabled: false,
    hnConfig: null,
    redditEnabled: false,
    redditConfig: null,
    webEnabled: false,
    webConfig: null,
    twitterEnabled: false,
    twitterConfig: null,
    webSearchEnabled: false,
    webSearchConfig: null,
    posthogEnabled: false,
    posthogProjectToken: null,
    posthogHost: null,
    pipelineTime,
    emailTime,
    linkedinTime: emailTime,
    twitterTime: emailTime,
    scheduleTimezone: data.timezone ?? "UTC",
    scheduleEnabled: true,
    emailEnabled: true,
    linkedinEnabled: false,
    twitterPostEnabled: false,
    autoReview: false,
    rankingPrompt: data.rankingPrompt ?? "",
    shortlistPrompt: data.shortlistPrompt ?? "",
    shortlistSize: 30,
  };
}

export async function activateTenant(
  deps: ActivateDeps,
  tenantId: string,
): Promise<ActivateResult> {
  const tenant = await deps.tenantsRepo.findById(tenantId);
  if (tenant === null) {
    throw new Error(`activateTenant: tenant ${tenantId} not found`);
  }

  const state = tenant.onboardingState;
  const sources = await deps.sourcesRepo.list();
  const missing = missingRequiredSteps(state, sources.length);
  if (missing.length > 0) {
    return { ok: false, blocked: { error: "incomplete", missing } };
  }
  const data = state?.data;
  if (state === null || data === undefined) {
    // Unreachable after the gate, but keeps the narrowing honest.
    return {
      ok: false,
      blocked: { error: "incomplete", missing: [...ONBOARDING_REQUIRED_STEPS] },
    };
  }

  // Apply the chosen slug (placeholder `pending-…` → real). The DB unique
  // index is the final arbiter of a race — the loser repicks (EDGE-001).
  const slug = (data.slug ?? "").trim().toLowerCase();
  try {
    await changeTenantSlug({ tenantsRepo: deps.tenantsRepo }, tenantId, slug);
  } catch (err) {
    if (err instanceof SlugChangeError) {
      return { ok: false, blocked: { error: "slug_taken", missing: ["slug"] } };
    }
    throw err;
  }

  const saved = await deps.settingsRepo.upsert(activationSettings(data));

  const completed = await deps.tenantsRepo.completeOnboarding(tenantId, {
    name: (data.name ?? "").trim(),
    headline: (data.headline ?? "").trim(),
    topicStrip: hasText(data.topicStrip) ? (data.topicStrip ?? "").trim() : null,
    subtagline: hasText(data.subtagline) ? (data.subtagline ?? "").trim() : null,
    onboardingState: { ...state, currentStep: "done" },
  });
  if (completed === null) {
    throw new Error(`activateTenant: tenant ${tenantId} vanished mid-activation`);
  }

  // REQ-035 — begin scheduled runs: per-tenant scheduler entries (P10 keys).
  await reconcilePipelineSchedule(deps.processingQueue, saved, tenantId);
  await reconcileCollectorHealthSchedule(
    deps.collectorHealthQueue,
    saved,
    tenantId,
  );

  return { ok: true, tenant: completed };
}
