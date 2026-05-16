import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import type IORedis from "ioredis";
import type { Queue, JobsOptions } from "bullmq";
import { startRun } from "@shared/run-start.js";
import type { RunProcessJobPayload } from "@shared/run-start.js";
import type { UserSettings } from "@shared/types/settings.js";
import type { RunState } from "@shared/types/run.js";

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

const baseSettings: UserSettings = {
  id: "settings-id",
  topN: 10,
  halfLifeHours: 24,
  hnEnabled: true,
  hnConfig: { sinceDays: 1 },
  redditEnabled: true,
  redditConfig: { subreddits: ["LocalLLaMA"], sinceDays: 1 },
  webEnabled: false,
  webConfig: null,
  twitterEnabled: false,
  twitterConfig: null,
  scheduleTime: "07:00",
  scheduleTimezone: "America/Los_Angeles",
  scheduleEnabled: false,
  rankingWorkflow: "",
  updatedAt: "2026-04-14T00:00:00.000Z",
};

describe("startRun", () => {
  it("seeds run:<runId> in redis with the correct JSON shape and TTL 3600", async () => {
    const redis = makeRedis();
    const q = makeQueue();
    const fixedId = "11111111-2222-3333-4444-555555555555";

    const { runId } = await startRun(baseSettings, {
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

    const { runId } = await startRun(baseSettings, {
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

  it("includes web source when webConfig is set and omits disabled sources", async () => {
    const redis = makeRedis();
    const q = makeQueue();
    const fixedId = "cccccccc-dddd-eeee-ffff-000000000000";

    const webSettings: UserSettings = {
      ...baseSettings,
      hnEnabled: false,
      hnConfig: null,
      redditEnabled: false,
      redditConfig: null,
      halfLifeHours: null,
      webEnabled: true,
      webConfig: {
        sources: [
          { name: "Anthropic", listingUrl: "https://www.anthropic.com/research" },
        ],
        maxItems: 3,
        sinceDays: 7,
      },
    };

    await startRun(webSettings, {
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
    expect(payload.collectors.web).toEqual(webSettings.webConfig);
    expect(payload.collectors.hn).toBeUndefined();
    expect(payload.collectors.reddit).toBeUndefined();
    expect(payload.halfLifeHours).toBeUndefined();
  });

  it("omits disabled collectors even when their configs are preserved", async () => {
    const redis = makeRedis();
    const q = makeQueue();
    const fixedId = "eeeeeeee-ffff-0000-1111-222222222222";

    const settings: UserSettings = {
      ...baseSettings,
      hnEnabled: false,
      redditEnabled: false,
      redditConfig: { subreddits: ["LocalLLaMA"], sinceDays: 1 },
    };

    await startRun(settings, {
      redis: redis as unknown as IORedis,
      queue: q.queue,
      runId: () => fixedId,
    });

    const entry = redis.store.get(`run:${fixedId}`);
    if (!entry) throw new Error("expected redis entry");
    const state = JSON.parse(entry.value) as RunState;
    expect(state.sources.hn).toBeUndefined();
    expect(state.sources.reddit).toBeUndefined();

    const [, data] = q.add.mock.calls[0] ?? [];
    const payload = data as RunProcessJobPayload;
    expect(payload.sourceTypes).toEqual([]);
    expect(payload.collectors.hn).toBeUndefined();
    expect(payload.collectors.reddit).toBeUndefined();
  });

  // REQ-024: twitterConfig flows from settings to job payload
  it("REQ-024: puts twitter on payload.collectors when settings has twitterConfig", async () => {
    const redis = makeRedis();
    const q = makeQueue();
    const fixedId = "ddddddd1-eeee-ffff-0000-111111111111";

    const twitterSettings: UserSettings = {
      ...baseSettings,
      hnEnabled: false,
      hnConfig: null,
      redditEnabled: false,
      redditConfig: null,
      twitterEnabled: true,
      twitterConfig: {
        listIds: ["12345"],
        users: [{ handle: "openai", userId: "9999" }],
        maxTweetsPerSource: 50,
        sinceHours: 24,
      },
    };

    await startRun(twitterSettings, {
      redis: redis as unknown as IORedis,
      queue: q.queue,
      runId: () => fixedId,
    });

    const [, data] = q.add.mock.calls[0] ?? [];
    const payload = data as RunProcessJobPayload;
    expect(payload.collectors.twitter).toEqual(twitterSettings.twitterConfig);
    expect(payload.sourceTypes).toContain("twitter");
  });

  // REQ-024: twitter omitted when twitterConfig is null
  it("REQ-024: omits twitter from payload when twitterConfig is null", async () => {
    const redis = makeRedis();
    const q = makeQueue();
    const fixedId = "ddddddd2-eeee-ffff-0000-222222222222";

    await startRun(baseSettings, {
      redis: redis as unknown as IORedis,
      queue: q.queue,
      runId: () => fixedId,
    });

    const [, data] = q.add.mock.calls[0] ?? [];
    const payload = data as RunProcessJobPayload;
    expect(payload.collectors.twitter).toBeUndefined();
    expect(payload.sourceTypes).not.toContain("twitter");
  });

  it("generates a uuid for runId when no generator is injected", async () => {
    const redis = makeRedis();
    const q = makeQueue();
    const { runId } = await startRun(baseSettings, {
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
