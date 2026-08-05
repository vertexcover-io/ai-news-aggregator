/**
 * Unit: the shared BullMQ queue factory.
 *
 * BullMQ keeps every completed and failed job forever by default, which grew
 * ~1000 completed jobs and ~860 orphaned job hashes on the prod `processing`
 * queue over three months. `createQueue` is the single place retention is
 * applied — a queue built without it silently reintroduces the leak, so these
 * tests pin the defaults, the override path, and the option plumbing.
 *
 * `bullmq` and the redis connection factory are both mocked: constructing a
 * real Queue dials Redis from its constructor, and what we are asserting is
 * precisely which options reach that constructor.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { QueueOptions } from "bullmq";

const queueCtor = vi.fn();
const fakeConnection = { tag: "created-by-factory" };

// A constructable stand-in for BullMQ's Queue that only records its arguments.
// Declared as a function (not a class) so it stays a pure constructor spy.
function FakeQueue(this: unknown, name: string, opts: QueueOptions): void {
  queueCtor(name, opts);
}

vi.mock("bullmq", () => ({ Queue: FakeQueue }));

vi.mock("@shared/db/redis.js", () => ({
  createRedisConnection: () => fakeConnection,
}));

const { createQueue, DEFAULT_JOB_OPTIONS } = await import("@shared/db/queue.js");

const optsFromLastCall = (): QueueOptions => {
  const call = queueCtor.mock.calls.at(-1);
  if (!call) throw new Error("Queue constructor was never called");
  return call[1] as QueueOptions;
};

describe("createQueue", () => {
  beforeEach(() => {
    queueCtor.mockClear();
  });

  it("applies the shared retention defaults", () => {
    createQueue("defaults");
    expect(queueCtor).toHaveBeenCalledOnce();
    expect(optsFromLastCall().defaultJobOptions).toEqual(DEFAULT_JOB_OPTIONS);
  });

  it("keeps failures longer and deeper than successes", () => {
    const { removeOnComplete, removeOnFail } = DEFAULT_JOB_OPTIONS;
    // Narrow away the `boolean | number` members of KeepJobs.
    if (typeof removeOnComplete !== "object" || typeof removeOnFail !== "object") {
      throw new Error("retention defaults must be KeepJobs objects, not booleans");
    }
    expect(removeOnFail.age).toBeGreaterThan(removeOnComplete.age ?? 0);
    expect(removeOnFail.count).toBeGreaterThan(removeOnComplete.count ?? 0);
  });

  it("opens its own redis connection when the caller supplies none", () => {
    createQueue("implicit-connection");
    expect(optsFromLastCall().connection).toBe(fakeConnection);
  });

  it("reuses a caller-supplied connection", () => {
    const caller = { tag: "caller-owned" } as unknown as QueueOptions["connection"];
    createQueue("explicit-connection", { connection: caller });
    expect(optsFromLastCall().connection).toBe(caller);
  });

  it("lets a caller replace the defaults", () => {
    const override = { removeOnComplete: { count: 5 } };
    createQueue("override", { defaultJobOptions: override });
    expect(optsFromLastCall().defaultJobOptions).toEqual(override);
  });

  it("passes non-connection options through to the queue", () => {
    createQueue("prefixed", { prefix: "{scoped}" });
    const opts = optsFromLastCall();
    expect(opts.prefix).toBe("{scoped}");
    expect(opts.defaultJobOptions).toEqual(DEFAULT_JOB_OPTIONS);
  });

  it("names the queue it was asked for", () => {
    createQueue("processing");
    expect(queueCtor.mock.calls.at(-1)?.[0]).toBe("processing");
  });
});
