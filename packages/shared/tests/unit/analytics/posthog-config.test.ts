import { describe, expect, it } from "vitest";
import {
  resolvePostHogConfig,
} from "../../../src/analytics/posthog-config.js";

describe("test_REQ_001_shared_resolve_posthog_config_single_source", () => {
  it("uses DB settings when present", () => {
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

  it("returns disabled when POSTHOG_ENABLED=false", () => {
    expect(
      resolvePostHogConfig(null, {
        POSTHOG_PROJECT_TOKEN: "phc_env",
        POSTHOG_HOST: "https://env.example.com",
        POSTHOG_ENABLED: "false",
      }),
    ).toEqual({
      posthogEnabled: false,
      posthogProjectToken: null,
      posthogHost: null,
    });
  });
});
