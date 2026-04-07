import { describe, it, expect, vi } from "vitest";
import type IORedis from "ioredis";
import type { FlowProducer, FlowJob } from "bullmq";
import type { RunState, RunSubmitPayload } from "@newsletter/shared";
import { createRun } from "@api/services/runs.js";

interface MockRedis {
  store: Map<string, { value: string; ttl: number }>;
  set: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
}

function makeRedis(): MockRedis {
  const store = new Map<string, { value: string; ttl: number }>();
  const set = vi.fn(
    (key: string, value: string, _mode: string, ttl: number) => {
      store.set(key, { value, ttl });
      return Promise.resolve("OK");
    },
  );
  const get = vi.fn((key: string) =>
    Promise.resolve(store.get(key)?.value ?? null),
  );
  return { store, set, get };
}

function makeFlow(): {
  add: ReturnType<typeof vi.fn>;
  producer: FlowProducer;
} {
  const add = vi.fn((node: FlowJob) => Promise.resolve({ job: { id: "1" }, children: node.children }));
  const producer = { add } as unknown as FlowProducer;
  return { add, producer };
}

const basePayload: RunSubmitPayload = {
  topN: 10,
  hn: { sinceDays: 1 },
  reddit: { subreddits: ["LocalLLaMA"], sinceDays: 1 },
};

describe("createRun (REQ-004, REQ-005)", () => {
  it("seeds Redis run-state with status running and stage queued (REQ-004)", async () => {
    const redis = makeRedis();
    const flow = makeFlow();
    const { runId } = await createRun(basePayload, redis as unknown as IORedis, flow.producer);

    expect(runId).toMatch(/^[0-9a-f-]{36}$/);
    const entry = redis.store.get(`run:${runId}`);
    if (!entry) throw new Error("expected redis entry to exist");
    expect(entry.ttl).toBe(3600);

    const state = JSON.parse(entry.value) as RunState;
    expect(state.id).toBe(runId);
    expect(state.status).toBe("running");
    expect(state.stage).toBe("queued");
    expect(state.topN).toBe(10);
    expect(state.sources.hn).toEqual({ status: "pending", itemsFetched: 0, errors: [] });
    expect(state.sources.reddit).toEqual({ status: "pending", itemsFetched: 0, errors: [] });
    expect(state.rankedItems).toBeNull();
  });

  it("enqueues a parent run-process flow on processing queue with one child per source (REQ-005)", async () => {
    const redis = makeRedis();
    const flow = makeFlow();
    await createRun(basePayload, redis as unknown as IORedis, flow.producer);

    expect(flow.add).toHaveBeenCalledTimes(1);
    const node = flow.add.mock.calls[0][0] as FlowJob;
    expect(node.name).toBe("run-process");
    expect(node.queueName).toBe("processing");
    const children = node.children ?? [];
    expect(children).toHaveLength(2);
    const childNames = children.map((c) => c.name).sort();
    expect(childNames).toEqual(["hn-collect", "reddit-collect"]);
    for (const child of children) {
      expect(child.queueName).toBe("collection");
    }
  });

  it("only enqueues hn child when reddit is omitted", async () => {
    const redis = makeRedis();
    const flow = makeFlow();
    await createRun(
      { topN: 5, hn: { sinceDays: 1 } },
      redis as unknown as IORedis,
      flow.producer,
    );
    const node = flow.add.mock.calls[0][0] as FlowJob;
    const children = node.children ?? [];
    expect(children).toHaveLength(1);
    expect(children[0]?.name).toBe("hn-collect");
  });
});
