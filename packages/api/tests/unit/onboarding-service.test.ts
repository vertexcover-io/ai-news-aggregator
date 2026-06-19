/**
 * P11 unit: onboarding slug availability + activation gate (pure logic).
 *
 * REQ-033 — slug validation reports available / taken / invalid (reserved).
 * EDGE-003 — reserved slugs rejected at validation.
 * REQ-025/038 — missingRequiredSteps drives the activation gate.
 */
import { describe, expect, it } from "vitest";
import type { OnboardingState } from "@newsletter/shared/types/tenant";
import {
  checkSlugAvailability,
  missingRequiredSteps,
} from "@api/services/onboarding.js";
import type { TenantRow } from "@api/repositories/tenants.js";

const SELF_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

function repoWithHolder(holderId: string | null): {
  tenantsRepo: { findBySlug: (slug: string) => Promise<TenantRow | null> };
} {
  return {
    tenantsRepo: {
      findBySlug: (slug: string) =>
        Promise.resolve(
          holderId === null ? null : ({ id: holderId, slug } as TenantRow),
        ),
    },
  };
}

describe("test_REQ_033_slug_validation_available_taken_invalid", () => {
  it.each([
    ["theinference", null, "available"],
    ["the-inference-2", null, "available"],
    ["Bad Slug", null, "invalid"],
    ["-leading", null, "invalid"],
    ["trailing-", null, "invalid"],
    ["", null, "invalid"],
    ["theinference", OTHER_ID, "taken"],
  ] as const)("%s (holder=%s) → %s", async (slug, holderId, expected) => {
    await expect(
      checkSlugAvailability(repoWithHolder(holderId), slug, SELF_ID),
    ).resolves.toBe(expected);
  });

  it("uppercase input is normalized before checking", async () => {
    await expect(
      checkSlugAvailability(repoWithHolder(null), "  TheInference  ", SELF_ID),
    ).resolves.toBe("available");
  });

  it("the tenant's own current slug reads as available (self re-check)", async () => {
    await expect(
      checkSlugAvailability(repoWithHolder(SELF_ID), "theinference", SELF_ID),
    ).resolves.toBe("available");
  });
});

describe("test_EDGE_003_reserved_slug_rejected", () => {
  it.each(["admin", "api", "app", "agentloop", "ADMIN"])(
    "reserved slug %s → reserved",
    async (slug) => {
      await expect(
        checkSlugAvailability(repoWithHolder(null), slug, SELF_ID),
      ).resolves.toBe("reserved");
    },
  );
});

function stateWith(
  data: NonNullable<OnboardingState["data"]>,
): OnboardingState {
  return { currentStep: "schedule", completedSteps: [], data };
}

const COMPLETE_DATA = {
  name: "The Inference",
  slug: "theinference",
  headline: "The daily read for inference.",
  rankingPrompt: "Rank by usefulness.",
  shortlistPrompt: "Keep inference items.",
  pipelineTime: "06:00",
  emailTime: "07:30",
  timezone: "UTC",
};

describe("missingRequiredSteps (activation gate, REQ-025/038)", () => {
  it("complete state with ≥1 source → no missing steps", () => {
    expect(missingRequiredSteps(stateWith(COMPLETE_DATA), 1)).toEqual([]);
  });

  it("null state → every required step is missing", () => {
    expect(missingRequiredSteps(null, 0)).toEqual([
      "name",
      "slug",
      "headline",
      "prompts",
      "sources",
      "schedule",
    ]);
  });

  it.each([
    [{ ...COMPLETE_DATA, name: "  " }, 1, ["name"]],
    [{ ...COMPLETE_DATA, slug: "Bad Slug" }, 1, ["slug"]],
    [{ ...COMPLETE_DATA, slug: "admin" }, 1, ["slug"]],
    [{ ...COMPLETE_DATA, headline: "" }, 1, ["headline"]],
    [{ ...COMPLETE_DATA, rankingPrompt: "" }, 1, ["prompts"]],
    [{ ...COMPLETE_DATA, shortlistPrompt: " " }, 1, ["prompts"]],
    [COMPLETE_DATA, 0, ["sources"]],
    [{ ...COMPLETE_DATA, pipelineTime: undefined }, 1, ["schedule"]],
    [{ ...COMPLETE_DATA, timezone: "" }, 1, ["schedule"]],
  ] as const)(
    "case %# reports exactly the missing steps",
    (data, sourcesCount, expected) => {
      expect(
        missingRequiredSteps(
          stateWith(data as NonNullable<OnboardingState["data"]>),
          sourcesCount,
        ),
      ).toEqual(expected);
    },
  );
});
