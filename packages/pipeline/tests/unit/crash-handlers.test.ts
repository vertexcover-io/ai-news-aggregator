import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Hoist the posthog mock so it's available before any module import
const { mockShutdownPostHog, mockCaptureException } = vi.hoisted(() => ({
  mockShutdownPostHog: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  mockCaptureException: vi.fn<(error: unknown, context?: Record<string, unknown>) => void>(),
}));

vi.mock("@pipeline/lib/posthog.js", () => ({
  captureException: mockCaptureException,
  shutdownPostHog: mockShutdownPostHog,
  capturePipelineEvent: vi.fn(),
  resetPostHogForTest: vi.fn(),
}));

// Import the crash-handler factory after the mock is set up
import { createFatalHandler } from "@pipeline/lib/crash-handlers.js";

describe("pipeline crash handlers", () => {
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockShutdownPostHog.mockResolvedValue(undefined);
    // Stub process.exit so it doesn't actually exit
    mockExit = vi.spyOn(process, "exit").mockImplementation((_code) => {
      return undefined as never;
    });
  });

  afterEach(() => {
    mockExit.mockRestore();
  });

  // REQ-009: crash handler captures, flushes, then exits
  describe("test_REQ_009_pipeline_crash_handler_captures_and_flushes", () => {
    it("calls captureException then shutdownPostHog then process.exit(1) for uncaughtException", async () => {
      const handler = createFatalHandler("uncaughtException");
      const err = new Error("fatal crash");

      await handler(err);

      expect(mockCaptureException).toHaveBeenCalledOnce();
      expect(mockCaptureException).toHaveBeenCalledWith(err, {
        fatal: true,
        source: "uncaughtException",
      });
      expect(mockShutdownPostHog).toHaveBeenCalledOnce();
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("calls captureException then shutdownPostHog then process.exit(1) for unhandledRejection", async () => {
      const handler = createFatalHandler("unhandledRejection");
      const err = new Error("unhandled rejection");

      await handler(err);

      expect(mockCaptureException).toHaveBeenCalledOnce();
      expect(mockCaptureException).toHaveBeenCalledWith(err, {
        fatal: true,
        source: "unhandledRejection",
      });
      expect(mockShutdownPostHog).toHaveBeenCalledOnce();
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("calls captureException before shutdownPostHog (order matters)", async () => {
      const callOrder: string[] = [];
      mockCaptureException.mockImplementation(() => { callOrder.push("capture"); });
      mockShutdownPostHog.mockImplementation(() => { callOrder.push("shutdown"); return Promise.resolve(); });

      const handler = createFatalHandler("uncaughtException");
      await handler(new Error("order test"));

      expect(callOrder).toEqual(["capture", "shutdown"]);
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });
});
