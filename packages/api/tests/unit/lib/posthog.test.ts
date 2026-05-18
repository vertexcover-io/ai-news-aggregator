import { afterEach, describe, expect, it } from "vitest";
import {
  captureAnalytics,
  resetAnalyticsForTest,
  shutdownAnalytics,
} from "@api/lib/posthog.js";
import { resolvePostHogConfig } from "@api/lib/posthog-config.js";

afterEach(async () => {
  await shutdownAnalytics();
  resetAnalyticsForTest();
});

describe("resolvePostHogConfig", () => {
  it("uses settings before env fallback", () => {
    expect(
      resolvePostHogConfig(
        {
          posthogEnabled: true,
          posthogProjectToken: "phc_settings",
          posthogHost: "https://us.i.posthog.com",
        },
        {
          POSTHOG_PROJECT_TOKEN: "phc_env",
          POSTHOG_HOST: "https://env.example.com",
        },
      ),
    ).toEqual({
      posthogEnabled: true,
      posthogProjectToken: "phc_settings",
      posthogHost: "https://us.i.posthog.com",
    });
  });

  it("uses env fallback when no settings row exists", () => {
    expect(
      resolvePostHogConfig(null, {
        POSTHOG_PROJECT_TOKEN: "phc_env",
        POSTHOG_HOST: "https://env.example.com",
      }),
    ).toEqual({
      posthogEnabled: true,
      posthogProjectToken: "phc_env",
      posthogHost: "https://env.example.com",
    });
  });
});

describe("captureAnalytics", () => {
  it("no-ops when analytics is disabled", async () => {
    await expect(
      captureAnalytics({ distinctId: "admin", event: "test_event" }),
    ).resolves.toBeUndefined();
  });
});
