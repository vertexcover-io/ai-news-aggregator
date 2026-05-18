import { afterEach, describe, expect, it, vi } from "vitest";

const posthogMocks = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
}));

vi.mock("posthog-js", () => ({
  default: {
    init: posthogMocks.init,
    capture: posthogMocks.capture,
  },
}));

vi.mock("../../../src/api/analyticsConfig", () => ({
  fetchAnalyticsConfig: vi.fn(),
}));

import { fetchAnalyticsConfig } from "../../../src/api/analyticsConfig";
import {
  captureBrowserEvent,
  initBrowserAnalytics,
  resetBrowserAnalyticsForTest,
} from "../../../src/lib/analytics";

const mockFetchAnalyticsConfig = vi.mocked(fetchAnalyticsConfig);

afterEach(() => {
  resetBrowserAnalyticsForTest();
  vi.clearAllMocks();
});

describe("initBrowserAnalytics", () => {
  it("does not initialize PostHog when runtime config is disabled", async () => {
    mockFetchAnalyticsConfig.mockResolvedValueOnce({
      posthogEnabled: false,
      posthogProjectToken: null,
      posthogHost: null,
    });

    await initBrowserAnalytics();

    expect(posthogMocks.init).not.toHaveBeenCalled();
  });

  it("initializes PostHog when runtime config is enabled", async () => {
    mockFetchAnalyticsConfig.mockResolvedValueOnce({
      posthogEnabled: true,
      posthogProjectToken: "phc_project_token",
      posthogHost: "https://us.i.posthog.com",
    });

    await initBrowserAnalytics();

    expect(posthogMocks.init).toHaveBeenCalledWith(
      "phc_project_token",
      expect.objectContaining({
        api_host: "https://us.i.posthog.com",
        capture_pageview: "history_change",
        capture_pageleave: "if_capture_pageview",
        disable_session_recording: true,
      }),
    );
  });
});

describe("captureBrowserEvent", () => {
  it("captures only after PostHog is initialized", async () => {
    captureBrowserEvent("archive_opened", { run_id: "run-1" });
    expect(posthogMocks.capture).not.toHaveBeenCalled();

    mockFetchAnalyticsConfig.mockResolvedValueOnce({
      posthogEnabled: true,
      posthogProjectToken: "phc_project_token",
      posthogHost: "https://us.i.posthog.com",
    });
    await initBrowserAnalytics();

    captureBrowserEvent("archive_opened", { run_id: "run-1" });
    expect(posthogMocks.capture).toHaveBeenCalledWith("archive_opened", {
      run_id: "run-1",
    });
  });
});
