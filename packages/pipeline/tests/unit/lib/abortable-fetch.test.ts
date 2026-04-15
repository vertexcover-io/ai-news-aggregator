import { describe, expect, it, vi } from "vitest";
import { withAbortSignal } from "@pipeline/lib/abortable-fetch.js";

describe("withAbortSignal", () => {
  it("injects the run signal when init has no signal", async () => {
    const base = vi.fn(() => Promise.resolve(new Response("ok")));
    const controller = new AbortController();
    const wrapped = withAbortSignal(base as unknown as typeof fetch, controller.signal);

    await wrapped("https://example.test");

    expect(base).toHaveBeenCalledTimes(1);
    const init = base.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBe(controller.signal);
  });

  it("chains the run signal with a caller-provided init.signal", async () => {
    const base = vi.fn(() => Promise.resolve(new Response("ok")));
    const runController = new AbortController();
    const innerController = new AbortController();
    const wrapped = withAbortSignal(base as unknown as typeof fetch, runController.signal);

    await wrapped("https://example.test", { signal: innerController.signal });

    const init = base.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal).not.toBe(runController.signal);
    expect(init.signal).not.toBe(innerController.signal);

    runController.abort(new Error("run cancelled"));
    expect(init.signal?.aborted).toBe(true);
  });

  it("aborts the forwarded signal when the inner signal aborts", async () => {
    const base = vi.fn(() => Promise.resolve(new Response("ok")));
    const runController = new AbortController();
    const innerController = new AbortController();
    const wrapped = withAbortSignal(base as unknown as typeof fetch, runController.signal);

    await wrapped("https://example.test", { signal: innerController.signal });
    const init = base.mock.calls[0][1] as RequestInit;

    innerController.abort(new Error("inner timeout"));
    expect(init.signal?.aborted).toBe(true);
  });
});
