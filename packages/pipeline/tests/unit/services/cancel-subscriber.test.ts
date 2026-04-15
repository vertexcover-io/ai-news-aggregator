import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCancelSubscriber } from "@pipeline/services/cancel-subscriber.js";

// Minimal EventEmitter-based mock for ioredis duplicate connections
function createMockSub() {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  const subscribed: string[] = [];
  const unsubscribed: string[] = [];
  let disconnected = false;

  const sub = {
    on: vi.fn((event: string, fn: (...args: unknown[]) => void) => {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(fn);
    }),
    subscribe: vi.fn((...channels: string[]) => {
      subscribed.push(...channels);
      return Promise.resolve(channels.length);
    }),
    unsubscribe: vi.fn((...channels: string[]) => {
      unsubscribed.push(...channels);
      return Promise.resolve(channels.length);
    }),
    disconnect: vi.fn(() => {
      disconnected = true;
    }),
    // Helper to emit a message event from the test
    emit: (event: string, ...args: unknown[]) => {
      for (const fn of listeners[event] ?? []) {
        fn(...args);
      }
    },
  };

  return { sub, subscribed, unsubscribed, get disconnected() { return disconnected; } };
}

vi.mock("@newsletter/shared/logger", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

describe("createCancelSubscriber", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("subscribes to run:cancel:{runId} on a duplicated connection", async () => {
    const { sub } = createMockSub();
    const connection = {
      duplicate: vi.fn(() => sub),
    };

    const factory = createCancelSubscriber(connection as unknown as import("ioredis").default);
    await factory.subscribe("run-42", vi.fn());

    expect(connection.duplicate).toHaveBeenCalledOnce();
    expect(sub.subscribe).toHaveBeenCalledWith("run:cancel:run-42");
  });

  it("calls onCancel when a message is received on the channel", async () => {
    const { sub } = createMockSub();
    const connection = { duplicate: vi.fn(() => sub) };

    const factory = createCancelSubscriber(connection as unknown as import("ioredis").default);
    const onCancel = vi.fn();
    await factory.subscribe("run-99", onCancel);

    // Simulate Redis pub/sub message delivery
    sub.emit("message", "run:cancel:run-99", "");

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("does not call onCancel for a different channel", async () => {
    const { sub } = createMockSub();
    const connection = { duplicate: vi.fn(() => sub) };

    const factory = createCancelSubscriber(connection as unknown as import("ioredis").default);
    const onCancel = vi.fn();
    await factory.subscribe("run-99", onCancel);

    sub.emit("message", "run:cancel:run-OTHER", "");

    expect(onCancel).not.toHaveBeenCalled();
  });

  it("close() unsubscribes and disconnects the duplicate client", async () => {
    const mock = createMockSub();
    const connection = { duplicate: vi.fn(() => mock.sub) };

    const factory = createCancelSubscriber(connection as unknown as import("ioredis").default);
    const subscription = await factory.subscribe("run-1", vi.fn());
    await subscription.close();

    expect(mock.unsubscribed).toContain("run:cancel:run-1");
    expect(mock.sub.disconnect).toHaveBeenCalledOnce();
  });

  it("close() does not throw if unsubscribe errors", async () => {
    const { sub } = createMockSub();
    sub.unsubscribe.mockRejectedValueOnce(new Error("redis gone"));
    const connection = { duplicate: vi.fn(() => sub) };

    const factory = createCancelSubscriber(connection as unknown as import("ioredis").default);
    const subscription = await factory.subscribe("run-1", vi.fn());

    // Should not throw
    await expect(subscription.close()).resolves.toBeUndefined();
  });
});
