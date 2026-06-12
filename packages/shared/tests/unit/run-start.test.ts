import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import type IORedis from "ioredis";
import type { Queue, JobsOptions } from "bullmq";
import { startRun } from "@shared/run-start.js";
import { TENANT_ZERO_ID } from "@shared/constants/tenant.js";
import type { RunProcessJobPayload, StartRunSettings } from "@shared/run-start.js";
import type { RunCollectorsPayload, RunState } from "@shared/types/run.js";

interface RedisEntry {
  value: string;
  ttl: number;
}

interface MockRedis {
  store: Map<string, RedisEntry>;
  set: ReturnType<typeof vi.fn>;
}

function makeRedis(): MockRedis {
  const store = new Map<string, RedisEntry>();
  const set = vi.fn(
    (key: string, value: string, _mode: string, ttl: number) => {
      store.set(key, { value, ttl });
      return Promise.resolve("OK");
    },
  );
  return { store, set };
}

function makeQueue(): {
  add: ReturnType<typeof vi.fn>;
  queue: Queue<RunProcessJobPayload>;
} {
  const add = vi.fn(
    (_name: string, _data: RunProcessJobPayload, opts?: JobsOptions) =>
      Promise.resolve({ id: opts?.jobId ?? "generated-id" }),
  );
  const queue = { add, name: "processing" } as unknown as Queue<RunProcessJobPayload>;
  return { add, queue };
}

const baseSettings: StartRunSettings = {
  topN: 10,
  halfLifeHours: 24,
};

const baseCollectors: RunCollectorsPayload = {
  hn: { sinceDays: 1 },
  reddit: { subreddits: ["LocalLLaMA"], sinceDays: 1 },
};

describe("startRun", () => {
  it("seeds run:<runId> in redis with the correct JSON shape and TTL 3600", async () => {
    const redis = makeRedis();
    const q = makeQueue();
    const fixedId = "11111111-2222-3333-4444-555555555555";

    const { runId } = await startRun(baseSettings, baseCollectors, {
      redis: redis as unknown as IORedis,
      queue: q.queue,
      runId: () => fixedId,
      now: () => new Date("2026-04-14T12:34:56.000Z"),
    });

    expect(runId).toBe(fixedId);
    const entry = redis.store.get(`run:${fixedId}`);
    if (!entry) throw new Error("expected redis entry");
    expect(entry.ttl).toBe(3600);

    const state = JSON.parse(entry.value) as RunState;
    expect(state.id).toBe(fixedId);
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
    expect(state.sources.blog).toBeUndefined();
    expect(state.rankedItems).toBeNull();
    expect(state.startedAt).toBe("2026-04-14T12:34:56.000Z");
    expect(state.updatedAt).toBe("2026-04-14T12:34:56.000Z");
  });

  it("enqueues a run-process job with jobId equal to the generated runId", async () => {
    const redis = makeRedis();
    const q = makeQueue();
    const fixedId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

    const { runId } = await startRun(baseSettings, baseCollectors, {
      redis: redis as unknown as IORedis,
      queue: q.queue,
      runId: () => fixedId,
    });

    expect(runId).toBe(fixedId);
    expect(q.add).toHaveBeenCalledTimes(1);
    const [name, data, opts] = q.add.mock.calls[0] ?? [];
    expect(name).toBe("run-process");
    expect((opts as JobsOptions | undefined)?.jobId).toBe(fixedId);

    const payload = data as RunProcessJobPayload;
    expect(payload.runId).toBe(fixedId);
    expect(payload.topN).toBe(10);
    expect(payload.sourceTypes.sort()).toEqual(["hn", "reddit"]);
    expect(payload.collectors.hn).toEqual({ sinceDays: 1 });
    expect(payload.collectors.reddit).toEqual({
      subreddits: ["LocalLLaMA"],
      sinceDays: 1,
    });
    expect(payload.collectors.web).toBeUndefined();
    expect(payload.halfLifeHours).toBe(24);
  });

  it("includes the web source and omits absent collectors", async () => {
    const redis = makeRedis();
    const q = makeQueue();
    const fixedId = "cccccccc-dddd-eeee-ffff-000000000000";

    const collectors: RunCollectorsPayload = {
      web: {
        sources: [
          { name: "Anthropic", listingUrl: "https://www.anthropic.com/research" },
        ],
        maxItems: 3,
        sinceDays: 7,
      },
    };

    await startRun({ topN: 10, halfLifeHours: null }, collectors, {
      redis: redis as unknown as IORedis,
      queue: q.queue,
      runId: () => fixedId,
    });

    const entry = redis.store.get(`run:${fixedId}`);
    if (!entry) throw new Error("expected redis entry");
    const state = JSON.parse(entry.value) as RunState;
    expect(state.sources.blog).toEqual({
      status: "pending",
      itemsFetched: 0,
      errors: [],
    });
    expect(state.sources.hn).toBeUndefined();
    expect(state.sources.reddit).toBeUndefined();

    const [, data] = q.add.mock.calls[0] ?? [];
    const payload = data as RunProcessJobPayload;
    expect(payload.sourceTypes).toEqual(["blog"]);
    expect(payload.collectors.web).toEqual(collectors.web);
    expect(payload.collectors.hn).toBeUndefined();
    expect(payload.collectors.reddit).toBeUndefined();
    expect(payload.halfLifeHours).toBeUndefined();
  });

  // REQ-073: only the collectors passed in (assembled from enabled rows) run.
  it("REQ-073: enqueues no collectors when the assembled payload is empty", async () => {
    const redis = makeRedis();
    const q = makeQueue();
    const fixedId = "eeeeeeee-ffff-0000-1111-222222222222";

    await startRun(baseSettings, {}, {
      redis: redis as unknown as IORedis,
      queue: q.queue,
      runId: () => fixedId,
    });

    const entry = redis.store.get(`run:${fixedId}`);
    if (!entry) throw new Error("expected redis entry");
    const state = JSON.parse(entry.value) as RunState;
    expect(state.sources).toEqual({});

    const [, data] = q.add.mock.calls[0] ?? [];
    const payload = data as RunProcessJobPayload;
    expect(payload.sourceTypes).toEqual([]);
    expect(payload.collectors).toEqual({});
  });

  // REQ-024: twitterConfig flows into the job payload
  it("REQ-024: puts twitter on payload.collectors when provided", async () => {
    const redis = makeRedis();
    const q = makeQueue();
    const fixedId = "ddddddd1-eeee-ffff-0000-111111111111";

    const collectors: RunCollectorsPayload = {
      twitter: {
        listIds: ["12345"],
        users: [{ handle: "openai", userId: "9999" }],
        maxTweetsPerSource: 50,
        sinceHours: 24,
      },
    };

    await startRun(baseSettings, collectors, {
      redis: redis as unknown as IORedis,
      queue: q.queue,
      runId: () => fixedId,
    });

    const [, data] = q.add.mock.calls[0] ?? [];
    const payload = data as RunProcessJobPayload;
    expect(payload.collectors.twitter).toEqual(collectors.twitter);
    expect(payload.sourceTypes).toContain("twitter");
  });

  it("REQ-024: omits twitter from payload when not provided", async () => {
    const redis = makeRedis();
    const q = makeQueue();
    const fixedId = "ddddddd2-eeee-ffff-0000-222222222222";

    await startRun(baseSettings, baseCollectors, {
      redis: redis as unknown as IORedis,
      queue: q.queue,
      runId: () => fixedId,
    });

    const [, data] = q.add.mock.calls[0] ?? [];
    const payload = data as RunProcessJobPayload;
    expect(payload.collectors.twitter).toBeUndefined();
    expect(payload.sourceTypes).not.toContain("twitter");
  });

  it("includes dryRun: true on the job payload when opts.dryRun is true", async () => {
    const redis = makeRedis();
    const q = makeQueue();
    const fixedId = "dddddd00-0000-0000-0000-000000000001";

    await startRun(
      baseSettings,
      baseCollectors,
      {
        redis: redis as unknown as IORedis,
        queue: q.queue,
        runId: () => fixedId,
      },
      { dryRun: true },
    );

    const [, data] = q.add.mock.calls[0] ?? [];
    const payload = data as RunProcessJobPayload;
    expect(payload.dryRun).toBe(true);
  });

  it("omits dryRun from the job payload when opts is undefined", async () => {
    const redis = makeRedis();
    const q = makeQueue();
    const fixedId = "dddddd00-0000-0000-0000-000000000002";

    await startRun(baseSettings, baseCollectors, {
      redis: redis as unknown as IORedis,
      queue: q.queue,
      runId: () => fixedId,
    });

    const [, data] = q.add.mock.calls[0] ?? [];
    const payload = data as RunProcessJobPayload;
    expect(payload.dryRun).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(payload, "dryRun")).toBe(false);
  });

  // PHASE5-C4: webSearch flows into the job payload
  it("PHASE5-C4: puts webSearch on payload.collectors when provided", async () => {
    const redis = makeRedis();
    const q = makeQueue();
    const fixedId = "phase5-web-search-enabled-111";

    const collectors: RunCollectorsPayload = {
      webSearch: {
        provider: "tavily",
        queries: [{ query: "AI news", sinceDays: 1, maxItems: 10 }],
      },
    };

    await startRun(baseSettings, collectors, {
      redis: redis as unknown as IORedis,
      queue: q.queue,
      runId: () => fixedId,
    });

    const [, data] = q.add.mock.calls[0] ?? [];
    const payload = data as RunProcessJobPayload;
    expect(payload.sourceTypes).toContain("web_search");
    expect(payload.collectors.webSearch).toEqual(collectors.webSearch);
    expect(payload.collectors.hn).toBeUndefined();
  });

  it("defaults payload.tenantId to TENANT_ZERO_ID when opts.tenantId is absent", async () => {
    const redis = makeRedis();
    const q = makeQueue();

    await startRun(baseSettings, baseCollectors, {
      redis: redis as unknown as IORedis,
      queue: q.queue,
      runId: () => "dddddd00-0000-0000-0000-000000000003",
    });

    const [, data] = q.add.mock.calls[0] ?? [];
    const payload = data as RunProcessJobPayload;
    expect(payload.tenantId).toBe(TENANT_ZERO_ID);
  });

  it("propagates opts.tenantId into the job payload", async () => {
    const redis = makeRedis();
    const q = makeQueue();
    const tenantId = "aaaaaaaa-0000-0000-0000-000000000042";

    await startRun(
      baseSettings,
      baseCollectors,
      {
        redis: redis as unknown as IORedis,
        queue: q.queue,
        runId: () => "dddddd00-0000-0000-0000-000000000004",
      },
      { tenantId },
    );

    const [, data] = q.add.mock.calls[0] ?? [];
    const payload = data as RunProcessJobPayload;
    expect(payload.tenantId).toBe(tenantId);
  });

  it("REQ-066: passes opts.startDelayMs through as the BullMQ delay", async () => {
    const redis = makeRedis();
    const q = makeQueue();
    await startRun(
      baseSettings,
      baseCollectors,
      {
        redis: redis as unknown as IORedis,
        queue: q.queue,
        runId: () => "eeeeee00-0000-0000-0000-000000000005",
      },
      { startDelayMs: 90_000 },
    );

    const [, , opts] = q.add.mock.calls[0] ?? [];
    expect((opts as JobsOptions).delay).toBe(90_000);
  });

  it("omits the delay option when startDelayMs is absent or 0", async () => {
    const redis = makeRedis();
    const q = makeQueue();
    await startRun(
      baseSettings,
      baseCollectors,
      {
        redis: redis as unknown as IORedis,
        queue: q.queue,
        runId: () => "eeeeee00-0000-0000-0000-000000000006",
      },
      { startDelayMs: 0 },
    );

    const [, , opts] = q.add.mock.calls[0] ?? [];
    expect(opts as JobsOptions).not.toHaveProperty("delay");
  });

  it("generates a uuid for runId when no generator is injected", async () => {
    const redis = makeRedis();
    const q = makeQueue();
    const { runId } = await startRun(baseSettings, baseCollectors, {
      redis: redis as unknown as IORedis,
      queue: q.queue,
    });
    expect(runId).toMatch(/^[0-9a-f-]{36}$/);
    const entry = redis.store.get(`run:${runId}`);
    expect(entry).toBeDefined();
  });
});

describe("REQ-030 grep assertion: single queue.add(\"run-process\") call site", () => {
  it("has exactly one source file containing the literal 'queue.add(\"run-process\"'", () => {
    const repoRoot = resolve(__dirname, "../../../..");
    const packagesDir = resolve(repoRoot, "packages");
    const needle = 'queue.add("run-process"';

    const hits: string[] = [];
    function walk(dir: string): void {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === "dist") continue;
        const full = join(dir, entry);
        const s = statSync(full);
        if (s.isDirectory()) {
          walk(full);
          continue;
        }
        if (!full.endsWith(".ts")) continue;
        // only source files, not tests
        if (full.includes("/tests/")) continue;
        const content = readFileSync(full, "utf8");
        if (content.includes(needle)) hits.push(full);
      }
    }
    walk(packagesDir);

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatch(/packages\/shared\/src\/run-start\.ts$/);
  });
});
