import { describe, it, expect, vi } from "vitest";
import type IORedis from "ioredis";
import type { Queue, JobsOptions } from "bullmq";
import type { RunState, RunSubmitPayload } from "@newsletter/shared";

vi.mock("bullmq", async (importOriginal) => {
  const actual = await importOriginal<typeof import("bullmq")>();
  return {
    ...actual,
    Queue: vi.fn().mockImplementation((_name: string, _opts: unknown) => ({
      name: _name,
      add: vi.fn().mockResolvedValue({ id: "mock-job-id" }),
      close: vi.fn(),
    })),
  };
});

vi.mock("@newsletter/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@newsletter/shared")>();
  return {
    ...actual,
    createRedisConnection: vi.fn(() => ({ fake: "redis-connection" })),
  };
});

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

function makeQueue(): { add: ReturnType<typeof vi.fn>; queue: Queue } {
  const add = vi.fn(
    (_name: string, _data: Record<string, unknown>, opts?: JobsOptions) =>
      Promise.resolve({ id: opts?.jobId ?? "generated-id" }),
  );
  const queue = { add, name: "processing" } as unknown as Queue;
  return { add, queue };
}

const basePayload: RunSubmitPayload = {
  topN: 10,
  hn: { sinceDays: 1 },
  reddit: { subreddits: ["LocalLLaMA"], sinceDays: 1 },
};

describe("createRun — single-job shape", () => {
  it("seeds Redis run-state with status running and stage queued", async () => {
    const redis = makeRedis();
    const q = makeQueue();
    const { runId } = await createRun(
      basePayload,
      redis as unknown as IORedis,
      q.queue,
    );

    expect(runId).toMatch(/^[0-9a-f-]{36}$/);
    const entry = redis.store.get(`run:${runId}`);
    if (!entry) throw new Error("expected redis entry to exist");
    expect(entry.ttl).toBe(3600);

    const state = JSON.parse(entry.value) as RunState;
    expect(state.id).toBe(runId);
    expect(state.status).toBe("running");
    expect(state.stage).toBe("queued");
    expect(state.topN).toBe(10);
    expect(state.sources.hn).toEqual({
      status: "pending",
      itemsFetched: 0,
      errors: [],
    });
    expect(state.sources.reddit).toEqual({
      status: "pending",
      itemsFetched: 0,
      errors: [],
    });
    expect(state.rankedItems).toBeNull();
  });

  it("REQ-001: enqueues exactly one run-process job on the processing queue", async () => {
    const redis = makeRedis();
    const q = makeQueue();
    await createRun(basePayload, redis as unknown as IORedis, q.queue);

    expect(q.add).toHaveBeenCalledTimes(1);
    const [name] = q.add.mock.calls[0] ?? [];
    expect(name).toBe("run-process");
  });

  it("REQ-002: sets job id equal to runId", async () => {
    const redis = makeRedis();
    const q = makeQueue();
    const { runId } = await createRun(
      basePayload,
      redis as unknown as IORedis,
      q.queue,
    );

    const [, , opts] = q.add.mock.calls[0] ?? [];
    expect((opts as JobsOptions | undefined)?.jobId).toBe(runId);
  });

  it("REQ-003: carries collector configs keyed by source for requested sources only", async () => {
    const redis = makeRedis();
    const q = makeQueue();
    await createRun(basePayload, redis as unknown as IORedis, q.queue);

    const [, data] = q.add.mock.calls[0] ?? [];
    const payload = data as {
      runId: string;
      topN: number;
      sourceTypes: string[];
      collectors: Record<string, unknown>;
    };
    expect(payload.collectors).toEqual({
      hn: { sinceDays: 1 },
      reddit: { subreddits: ["LocalLLaMA"], sinceDays: 1 },
    });
    expect(payload.collectors).not.toHaveProperty("web");
    expect(payload.sourceTypes.sort()).toEqual(["hn", "reddit"]);
    expect(payload.topN).toBe(10);
  });

  it("only enqueues hn collector when reddit and web are omitted", async () => {
    const redis = makeRedis();
    const q = makeQueue();
    await createRun(
      { topN: 5, hn: { sinceDays: 1 } },
      redis as unknown as IORedis,
      q.queue,
    );

    const [, data] = q.add.mock.calls[0] ?? [];
    const payload = data as {
      sourceTypes: string[];
      collectors: Record<string, unknown>;
    };
    expect(payload.collectors).toEqual({ hn: { sinceDays: 1 } });
    expect(payload.sourceTypes).toEqual(["hn"]);
  });

  it("seeds sources.blog and includes web config when payload.web is set", async () => {
    const redis = makeRedis();
    const q = makeQueue();
    const webPayload: RunSubmitPayload = {
      topN: 5,
      web: {
        sources: [
          {
            name: "Anthropic",
            listingUrl: "https://www.anthropic.com/research",
          },
        ],
        maxItems: 3,
        sinceDays: 7,
      },
    };
    const { runId } = await createRun(
      webPayload,
      redis as unknown as IORedis,
      q.queue,
    );

    const entry = redis.store.get(`run:${runId}`);
    if (!entry) throw new Error("expected redis entry to exist");
    const state = JSON.parse(entry.value) as RunState;
    expect(state.sources.blog).toEqual({
      status: "pending",
      itemsFetched: 0,
      errors: [],
    });

    const [, data] = q.add.mock.calls[0] ?? [];
    const payload = data as {
      sourceTypes: string[];
      collectors: { web?: unknown };
    };
    expect(payload.sourceTypes).toEqual(["blog"]);
    expect(payload.collectors.web).toEqual({
      sources: [
        {
          name: "Anthropic",
          listingUrl: "https://www.anthropic.com/research",
        },
      ],
      maxItems: 3,
      sinceDays: 7,
    });
  });
});

describe("createRun — lazy queue construction", () => {
  it("creates a Queue lazily when no processingQueue is provided", async () => {
    const redis = makeRedis();
    // Call createRun with only payload and redis — no processingQueue argument.
    // This triggers getDefaultProcessingQueue() internally, which calls new Queue(...).
    const { runId } = await createRun(
      basePayload,
      redis as unknown as IORedis,
    );
    expect(runId).toMatch(/^[0-9a-f-]{36}$/);
    const { Queue: QueueMock } = await import("bullmq");
    expect(QueueMock).toHaveBeenCalled();
  });
});
