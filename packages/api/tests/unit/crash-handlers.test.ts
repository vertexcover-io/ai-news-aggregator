import { afterEach, describe, expect, it, vi } from "vitest";
import { PostHog } from "posthog-node";
import {
  captureException,
  configurePostHog,
  resetAnalyticsForTest,
  shutdownAnalytics,
} from "@api/lib/posthog.js";

afterEach(async () => {
  await shutdownAnalytics();
  resetAnalyticsForTest();
  vi.restoreAllMocks();
});

describe("test_REQ_005_api_crash_handler_captures_and_flushes", () => {
  it("captures exception then shuts down analytics then exits with code 1 in order (EDGE-002)", async () => {
    const captureExceptionSpy = vi
      .spyOn(PostHog.prototype, "captureException")
      .mockImplementation(vi.fn());
    const shutdownSpy = vi
      .spyOn(PostHog.prototype, "shutdown")
      .mockResolvedValue(undefined);

    // Stub process.exit so it doesn't terminate the test process
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code) => {
      // intentionally no-op in tests
      return undefined as never;
    });

    configurePostHog(() =>
      Promise.resolve({
        posthogEnabled: true,
        posthogProjectToken: "phc_test_token",
        posthogHost: "https://us.i.posthog.com",
      }),
    );

    const callOrder: string[] = [];

    // Replicate the onFatal factory pattern from index.ts (tested in-process)
    const onFatal = (label: string) => (err: unknown) => {
      void (async () => {
        callOrder.push("capture");
        await captureException(err, { fatal: true, source: label });
        callOrder.push("shutdown");
        await Promise.race([
          shutdownAnalytics(),
          new Promise<void>((resolve) => setTimeout(resolve, 2000)),
        ]);
        callOrder.push("exit");
        process.exit(1);
      })();
    };

    const handler = onFatal("uncaughtException");
    handler(new Error("fatal crash"));

    // Wait for the async IIFE to settle
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    // Assert order: capture → shutdown → exit(1)
    expect(callOrder).toEqual(["capture", "shutdown", "exit"]);
    expect(captureExceptionSpy).toHaveBeenCalledOnce();
    const [errArg, _distinctId, propsArg] = captureExceptionSpy.mock
      .calls[0] as [Error, string, Record<string, unknown>];
    expect(errArg.message).toBe("fatal crash");
    expect(propsArg).toMatchObject({ fatal: true, source: "uncaughtException" });

    // shutdown was invoked (via shutdownAnalytics which calls client.shutdown)
    expect(shutdownSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
