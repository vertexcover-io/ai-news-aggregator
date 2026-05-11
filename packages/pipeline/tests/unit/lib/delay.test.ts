import { describe, it, expect } from "vitest";
import { delay } from "@pipeline/lib/delay.js";

describe("delay", () => {
  it("resolves after the specified duration when no signal is provided", async () => {
    const start = Date.now();
    await delay(10);
    expect(Date.now() - start).toBeGreaterThanOrEqual(9);
  });

  it("resolves normally when signal is not yet aborted", async () => {
    const controller = new AbortController();
    await expect(delay(10, controller.signal)).resolves.toBeUndefined();
  });

  it("rejects immediately when signal is already aborted before calling delay", async () => {
    const controller = new AbortController();
    const reason = new Error("pre-aborted");
    controller.abort(reason);
    await expect(delay(100, controller.signal)).rejects.toThrow("pre-aborted");
  });

  it("rejects with a generic Error when signal.reason is not an Error and signal is pre-aborted", async () => {
    const controller = new AbortController();
    controller.abort("string reason");
    await expect(delay(100, controller.signal)).rejects.toThrow("aborted");
  });

  it("rejects when signal is aborted while the timer is running", async () => {
    const controller = new AbortController();
    const reason = new Error("mid-flight abort");
    const promise = delay(500, controller.signal);
    // Abort after a short tick so the timer is already running
    setTimeout(() => { controller.abort(reason); }, 5);
    await expect(promise).rejects.toThrow("mid-flight abort");
  });

  it("rejects with generic Error when signal aborts with a non-Error reason mid-flight", async () => {
    const controller = new AbortController();
    const promise = delay(500, controller.signal);
    setTimeout(() => { controller.abort(42); }, 5);
    await expect(promise).rejects.toThrow("aborted");
  });
});
