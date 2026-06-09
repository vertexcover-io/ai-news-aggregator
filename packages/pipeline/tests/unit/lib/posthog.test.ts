import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Hoist mocks so they're available before module initialization
const { mockPostHogInstance, MockPostHog } = vi.hoisted(() => {
  const mockPostHogInstance = {
    captureException: vi.fn<(error: Error, distinctId: string, context?: Record<string, unknown>) => void>(),
    capture: vi.fn<(event: { distinctId: string; event: string; properties?: Record<string, unknown> }) => void>(),
    flush: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    shutdown: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
  const MockPostHog = vi.fn().mockImplementation(() => mockPostHogInstance);
  return { mockPostHogInstance, MockPostHog };
});

vi.mock("posthog-node", () => ({
  PostHog: MockPostHog,
}));

import {
  captureException,
  capturePipelineEvent,
  shutdownPostHog,
  resetPostHogForTest,
} from "@pipeline/lib/posthog.js";

describe("pipeline posthog module", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Re-apply the MockPostHog implementation and restore default mocks after resetAllMocks
    MockPostHog.mockImplementation(() => mockPostHogInstance);
    mockPostHogInstance.flush.mockResolvedValue(undefined);
    mockPostHogInstance.shutdown.mockResolvedValue(undefined);
    resetPostHogForTest();
    // clear env vars
    delete process.env.POSTHOG_PROJECT_TOKEN;
    delete process.env.POSTHOG_HOST;
    delete process.env.POSTHOG_ENABLED;
    delete process.env.POSTHOG_API_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetPostHogForTest();
    delete process.env.POSTHOG_PROJECT_TOKEN;
    delete process.env.POSTHOG_HOST;
    delete process.env.POSTHOG_ENABLED;
    delete process.env.POSTHOG_API_KEY;
  });

  // REQ-006: module surface — exports exist; client constructed when token set
  describe("test_REQ_006_pipeline_posthog_module_surface", () => {
    it("exports captureException, capturePipelineEvent, and shutdownPostHog", () => {
      expect(typeof captureException).toBe("function");
      expect(typeof capturePipelineEvent).toBe("function");
      expect(typeof shutdownPostHog).toBe("function");
    });

    it("constructs a PostHog client when POSTHOG_PROJECT_TOKEN is set", () => {
      process.env.POSTHOG_PROJECT_TOKEN = "phc_test_token";
      process.env.POSTHOG_HOST = "https://us.i.posthog.com";

      captureException(new Error("test"));

      expect(MockPostHog).toHaveBeenCalledOnce();
      expect(MockPostHog).toHaveBeenCalledWith("phc_test_token", expect.objectContaining({
        host: "https://us.i.posthog.com",
        enableExceptionAutocapture: true,
      }));
    });

    it("does not construct a client when POSTHOG_PROJECT_TOKEN is absent", () => {
      // no token set
      captureException(new Error("no token"));
      expect(MockPostHog).not.toHaveBeenCalled();
    });
  });

  // REQ-012: no-op when unconfigured
  describe("test_REQ_012_capture_noop_when_unconfigured", () => {
    it("captureException returns without throwing when no token", () => {
      expect(() => captureException(new Error("unconfigured"))).not.toThrow();
      expect(mockPostHogInstance.captureException).not.toHaveBeenCalled();
    });

    it("capturePipelineEvent returns without throwing when no token", () => {
      expect(() => capturePipelineEvent("test_event")).not.toThrow();
      expect(mockPostHogInstance.capture).not.toHaveBeenCalled();
    });
  });

  // EDGE-005: host set but token absent → disabled
  describe("test_EDGE_005_host_without_token_disabled", () => {
    it("does not construct a client when host is set but token is absent", () => {
      process.env.POSTHOG_HOST = "https://us.i.posthog.com";
      // no token

      captureException(new Error("host without token"));

      expect(MockPostHog).not.toHaveBeenCalled();
      expect(mockPostHogInstance.captureException).not.toHaveBeenCalled();
    });
  });

  // REQ-013: swallows transport errors
  describe("test_REQ_013_capture_swallows_transport_error", () => {
    it("captureException does not throw when client.captureException throws", () => {
      process.env.POSTHOG_PROJECT_TOKEN = "phc_test_token";
      mockPostHogInstance.captureException.mockImplementation(() => {
        throw new Error("transport error");
      });

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      expect(() => captureException(new Error("capture fails"))).not.toThrow();
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy.mock.calls[0]?.[0]).toContain("[posthog]");

      warnSpy.mockRestore();
    });

    it("capturePipelineEvent does not throw when client.capture throws", () => {
      process.env.POSTHOG_PROJECT_TOKEN = "phc_test_token";
      mockPostHogInstance.capture.mockImplementation(() => {
        throw new Error("transport error");
      });

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      expect(() => capturePipelineEvent("my_event")).not.toThrow();
      expect(warnSpy).toHaveBeenCalledOnce();

      warnSpy.mockRestore();
    });
  });

  // REQ-015: capture does not await flush
  describe("test_REQ_015_capture_does_not_await_flush", () => {
    it("captureException does not call flush or shutdown on the hot path", () => {
      process.env.POSTHOG_PROJECT_TOKEN = "phc_test_token";

      captureException(new Error("no flush"));

      expect(mockPostHogInstance.flush).not.toHaveBeenCalled();
      expect(mockPostHogInstance.shutdown).not.toHaveBeenCalled();
    });

    it("capturePipelineEvent does not call flush or shutdown on the hot path", () => {
      process.env.POSTHOG_PROJECT_TOKEN = "phc_test_token";

      capturePipelineEvent("my_event");

      expect(mockPostHogInstance.flush).not.toHaveBeenCalled();
      expect(mockPostHogInstance.shutdown).not.toHaveBeenCalled();
    });
  });
});
