/**
 * P11 unit: activateTenant (REQ-035 happy path, REQ-028/038 blocked,
 * EDGE-001 slug race) against injected fakes — the DB-backed journey is
 * covered by tests/e2e/onboarding.e2e.test.ts.
 */
import { describe, expect, it, vi } from "vitest";
import type { OnboardingState } from "@newsletter/shared/types/tenant";
import { activateTenant, type ActivateDeps } from "@api/services/onboarding.js";
import type { TenantRow } from "@api/repositories/tenants.js";
import type { SourceRow } from "@newsletter/shared/db";
import type { UserSettings } from "@newsletter/shared";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

const COMPLETE_STATE: OnboardingState = {
  currentStep: "schedule",
  completedSteps: ["name", "slug", "homepage", "prompts", "sources"],
  data: {
    name: "The Inference",
    slug: "theinference",
    headline: "The daily read for inference.",
    topicStrip: "Serving · Quantization",
    subtagline: "Just the runtime.",
    rankingPrompt: "Rank by usefulness.",
    shortlistPrompt: "Keep inference items.",
    pipelineTime: "06:00",
    emailTime: "07:30",
    timezone: "UTC",
  },
};

function makeTenant(overrides: Partial<TenantRow> = {}): TenantRow {
  return {
    id: TENANT_ID,
    slug: "pending-abc123",
    previousSlug: null,
    name: "Signup Name",
    status: "pending_setup",
    customDomain: null,
    headline: null,
    topicStrip: null,
    subtagline: null,
    logoBytes: null,
    logoContentType: null,
    featureCanon: false,
    featureDeliverability: false,
    featureEval: false,
    onboardingState: COMPLETE_STATE,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as TenantRow;
}

interface FakeOptions {
  tenant?: TenantRow;
  sources?: number;
  slugHolder?: TenantRow | null;
}

function makeDeps(opts: FakeOptions = {}): {
  deps: ActivateDeps;
  upsert: ReturnType<typeof vi.fn>;
  completeOnboarding: ReturnType<typeof vi.fn>;
  processingUpserts: ReturnType<typeof vi.fn>;
} {
  const tenant = opts.tenant ?? makeTenant();
  const completeOnboarding = vi.fn((id: string, profile: unknown) =>
    Promise.resolve({
      ...tenant,
      ...(profile as Partial<TenantRow>),
      id,
      status: "active" as const,
    }),
  );
  const upsert = vi.fn((input: unknown) =>
    Promise.resolve({
      ...(input as Record<string, unknown>),
      id: "settings-1",
      updatedAt: new Date().toISOString(),
      scheduleTime: "06:00",
    } as unknown as UserSettings),
  );
  const processingUpserts = vi.fn(() => Promise.resolve(undefined));
  const deps: ActivateDeps = {
    tenantsRepo: {
      findById: vi.fn(() => Promise.resolve(tenant)),
      findBySlug: vi.fn(() => Promise.resolve(opts.slugHolder ?? null)),
      updateSlug: vi.fn((id: string, slug: string) =>
        Promise.resolve({ ...tenant, id, slug }),
      ),
      completeOnboarding,
    },
    sourcesRepo: {
      list: vi.fn(() =>
        // The service only reads .length — empty objects are sufficient rows.
        Promise.resolve(
          Array.from(
            { length: opts.sources ?? 1 },
            () => ({}) as SourceRow,
          ),
        ),
      ),
    },
    settingsRepo: { upsert },
    processingQueue: {
      upsertJobScheduler: processingUpserts,
      removeJobScheduler: vi.fn(() => Promise.resolve(undefined)),
    } as unknown as ActivateDeps["processingQueue"],
    collectorHealthQueue: {
      upsertJobScheduler: vi.fn(() => Promise.resolve(undefined)),
      removeJobScheduler: vi.fn(() => Promise.resolve(undefined)),
    } as unknown as ActivateDeps["collectorHealthQueue"],
  };
  return { deps, upsert, completeOnboarding, processingUpserts };
}

describe("activateTenant", () => {
  it("test_REQ_035_activate_when_required_complete: applies profile + settings, flips active, reconciles schedulers", async () => {
    const { deps, upsert, completeOnboarding, processingUpserts } = makeDeps();
    const result = await activateTenant(deps, TENANT_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tenant.status).toBe("active");

    // Slug applied via the rename path (placeholder → chosen slug).
    expect(deps.tenantsRepo.updateSlug).toHaveBeenCalledWith(
      TENANT_ID,
      "theinference",
    );
    // Profile applied with the wizard's homepage slots.
    expect(completeOnboarding).toHaveBeenCalledWith(
      TENANT_ID,
      expect.objectContaining({
        name: "The Inference",
        headline: "The daily read for inference.",
        topicStrip: "Serving · Quantization",
        subtagline: "Just the runtime.",
      }),
    );
    // Settings persisted with the wizard prompts + schedule, enabled.
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        rankingPrompt: "Rank by usefulness.",
        shortlistPrompt: "Keep inference items.",
        pipelineTime: "06:00",
        emailTime: "07:30",
        scheduleTimezone: "UTC",
        scheduleEnabled: true,
      }),
    );
    // Per-tenant scheduler entries created (REQ-035 "begin scheduled runs").
    const keys = processingUpserts.mock.calls.map((call) => call[0] as string);
    expect(keys).toContain(`pipeline-run:${TENANT_ID}`);
  });

  it("test_REQ_038_activation_blocked_lists_missing: incomplete → blocked with the missing steps, nothing applied", async () => {
    const incomplete: OnboardingState = {
      ...COMPLETE_STATE,
      data: { ...COMPLETE_STATE.data, headline: "", rankingPrompt: "" },
    };
    const { deps, upsert, completeOnboarding, processingUpserts } = makeDeps({
      tenant: makeTenant({ onboardingState: incomplete }),
      sources: 0,
    });
    const result = await activateTenant(deps, TENANT_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.blocked.error).toBe("incomplete");
    expect(result.blocked.missing).toEqual(["headline", "prompts", "sources"]);
    expect(upsert).not.toHaveBeenCalled();
    expect(completeOnboarding).not.toHaveBeenCalled();
    expect(processingUpserts).not.toHaveBeenCalled();
  });

  it("test_EDGE_001_slug_race_unique_loser_taken: another tenant holds the slug → slug_taken, stays pending", async () => {
    const { deps, completeOnboarding } = makeDeps({
      slugHolder: makeTenant({
        id: "22222222-2222-4222-8222-222222222222",
        slug: "theinference",
      }),
    });
    const result = await activateTenant(deps, TENANT_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.blocked.error).toBe("slug_taken");
    expect(result.blocked.missing).toEqual(["slug"]);
    expect(completeOnboarding).not.toHaveBeenCalled();
  });
});
