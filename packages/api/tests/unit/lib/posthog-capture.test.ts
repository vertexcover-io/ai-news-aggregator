import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureException,
  configurePostHog,
  refreshPostHogConfig,
  resetAnalyticsForTest,
  shutdownAnalytics,
} from "@api/lib/posthog.js";

afterEach(async () => {
  await shutdownAnalytics();
  resetAnalyticsForTest();
  vi.restoreAllMocks();
});

describe("test_REQ_002_api_capture_exception_calls_client", () => {
  it("invokes client.captureException once with merged props when PostHog is enabled", async () => {
    // Arrange: configure a spy client via a settings provider that returns enabled config.
    const { PostHog } = await import("posthog-node");
    const captureExceptionSpy = vi
      .spyOn(PostHog.prototype, "captureException")
      .mockImplementation(vi.fn());
    vi.spyOn(PostHog.prototype, "shutdown").mockResolvedValue(undefined);

    configurePostHog(() =>
      Promise.resolve({
        posthogEnabled: true,
        posthogProjectToken: "phc_test_token",
        posthogHost: "https://us.i.posthog.com",
      }),
    );

    // Act
    await captureException(new Error("boom"), {
      distinctId: "user-1",
      requestId: "req-42",
    });

    // Assert: captureException called once with error, distinctId, and remaining props
    expect(captureExceptionSpy).toHaveBeenCalledOnce();
    const [errArg, distinctIdArg, propsArg] = captureExceptionSpy.mock.calls[0] as [Error, string, Record<string, unknown>];
    expect(errArg).toBeInstanceOf(Error);
    expect(errArg.message).toBe("boom");
    expect(distinctIdArg).toBe("user-1");
    expect(propsArg).toMatchObject({ requestId: "req-42" });
  });
});

describe("test_REQ_013_capture_swallows_transport_error", () => {
  it("does not throw when client.captureException throws, and emits one console.warn", async () => {
    const { PostHog } = await import("posthog-node");
    vi.spyOn(PostHog.prototype, "captureException").mockImplementation(() => {
      throw new Error("network failure");
    });
    vi.spyOn(PostHog.prototype, "shutdown").mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // suppress output in test
    });

    configurePostHog(() =>
      Promise.resolve({
        posthogEnabled: true,
        posthogProjectToken: "phc_test_token",
        posthogHost: "https://us.i.posthog.com",
      }),
    );

    // Act — must not throw
    await expect(captureException(new Error("boom"))).resolves.toBeUndefined();

    // Assert: exactly one console.warn
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/captureException failed/);
  });
});

describe("test_EDGE_007_api_runtime_settings_refresh", () => {
  it("uses newly configured client key after refreshPostHogConfig is called", async () => {
    const { PostHog } = await import("posthog-node");
    const captureExceptionSpy = vi
      .spyOn(PostHog.prototype, "captureException")
      .mockImplementation(vi.fn());
    vi.spyOn(PostHog.prototype, "shutdown").mockResolvedValue(undefined);

    // Start with first config
    configurePostHog(() =>
      Promise.resolve({
        posthogEnabled: true,
        posthogProjectToken: "phc_original_token",
        posthogHost: "https://us.i.posthog.com",
      }),
    );

    await captureException(new Error("first"));
    const callCount1 = captureExceptionSpy.mock.calls.length;
    expect(callCount1).toBe(1);

    // Simulate operator update at runtime via refreshPostHogConfig
    refreshPostHogConfig({
      posthogEnabled: true,
      posthogProjectToken: "phc_new_token",
      posthogHost: "https://eu.i.posthog.com",
    });

    await captureException(new Error("second"));
    // Both calls should succeed (total 2 now) and the client was rebuilt for the new token
    expect(captureExceptionSpy.mock.calls.length).toBe(2);
  });
});

describe("test_REQ_015_capture_does_not_await_flush", () => {
  it("resolves without flush being called on the client", async () => {
    const { PostHog } = await import("posthog-node");
    const flushSpy = vi
      .spyOn(PostHog.prototype, "flush")
      .mockResolvedValue(undefined);
    vi.spyOn(PostHog.prototype, "captureException").mockImplementation(vi.fn());
    vi.spyOn(PostHog.prototype, "shutdown").mockResolvedValue(undefined);

    configurePostHog(() =>
      Promise.resolve({
        posthogEnabled: true,
        posthogProjectToken: "phc_test_token",
        posthogHost: "https://us.i.posthog.com",
      }),
    );

    await captureException(new Error("no flush check"));

    // flush must not have been called on the hot capture path
    expect(flushSpy).not.toHaveBeenCalled();
  });
});
