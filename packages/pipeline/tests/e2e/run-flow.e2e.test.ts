/**
 * Phase 8 end-to-end seam test: real Redis, real Postgres, real BullMQ
 * FlowProducer + two workers (collection-style child + run-process parent),
 * with only the external collector network calls and the LLM rank function
 * stubbed out via dependency injection.
 *
 * Why "seam" rather than the production `handleCollectionJob`: that handler
 * is bound to the module-scoped run-state singleton and constructs its own
 * collectors with no fetch injection, so we cannot point it at fixture HTTP
 * responses without monkey-patching globals. Instead we register a test
 * collection worker that performs the same observable side-effects (seed
 * raw_items + report run-source state) and lets the real FlowProducer drive
 * the fan-in into the real run-process handler. This exercises:
 *
 *   - FlowProducer parent-after-children barrier semantics
 *   - run-state Redis transitions across two workers
 *   - real dedup against canonical URLs in raw_items
 *   - real candidate loader against Postgres
 *   - run-process completion path with rankedItems persisted to Redis
 *
 * The all-collectors-fail variant covers REQ-044.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  vi,
} from "vitest";
import { config } from "dotenv";
import { resolve } from "node:path";
import {
  FlowProducer,
  Queue,
  QueueEvents,
  Worker,
  type Job,
} from "bullmq";
import { rawItems } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { RunState } from "@newsletter/shared/types";
import {
  handleRunProcessJob,
  type RunProcessJobLike,
  type RunProcessResult,
} from "@pipeline/workers/run-process.js";
import { loadCandidatesSince } from "@pipeline/services/candidate-loader.js";
import {
  createRunStateService,
  type RunSourceType,
} from "@pipeline/services/run-state.js";
import { createRawItemsRepo } from "@pipeline/repositories/raw-items.js";
import { getTestDb, truncateAll } from "@pipeline-tests/e2e/setup/test-db.js";
import {
  getTestRedis,
  closeTestRedis,
} from "@pipeline-tests/e2e/setup/test-redis.js";

config({ path: resolve(import.meta.dirname, "../../../../.env.test") });

const COLLECT_QUEUE = "run-flow-e2e-collection";
const PROCESS_QUEUE = "run-flow-e2e-processing";

interface CollectChildData {
  runId: string;
  sourceType: RunSourceType;
  mode: "seed-hn" | "seed-reddit" | "fail";
}

interface ProcessParentData {
  runId: string;
  topN: number;
  sourceTypes: ("hn" | "reddit")[];
}

async function pollUntilTerminal(
  get: () => Promise<RunState | null>,
  timeoutMs: number,
): Promise<RunState> {
  const start = Date.now();
  for (;;) {
    const state = await get();
    if (state && (state.status === "completed" || state.status === "failed")) {
      return state;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `timed out waiting for terminal run-state (last=${JSON.stringify(state)})`,
      );
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe("run flow end-to-end (seam)", () => {
  let db: AppDb;
  let collectionWorker: Worker<CollectChildData, void>;
  let processWorker: Worker<ProcessParentData, RunProcessResult>;
  let flowProducer: FlowProducer;
  let processQueueEvents: QueueEvents;
  let collectionQueue: Queue<CollectChildData, void>;
  let processQueue: Queue<ProcessParentData, RunProcessResult>;
  // Mutable rank fn so individual tests can override behaviour.
  let rankFnImpl: (
    candidates: { id: number }[],
    options: { topN: number },
  ) => Promise<{
    rankedItems: { rawItemId: number; score: number; rationale: string }[];
    candidateCount: number;
    rankedCount: number;
  }>;

  const defaultRankFn: typeof rankFnImpl = (candidates, options) =>
    Promise.resolve({
      rankedItems: candidates.slice(0, options.topN).map((c, idx) => ({
        rawItemId: c.id,
        score: 1 - idx * 0.1,
        rationale: "deterministic test rank",
      })),
      candidateCount: candidates.length,
      rankedCount: Math.min(candidates.length, options.topN),
    });

  beforeAll(() => {
    db = getTestDb();
    const connection = getTestRedis();
    const runStateService = createRunStateService(connection);
    const repo = createRawItemsRepo(db);

    rankFnImpl = defaultRankFn;

    collectionQueue = new Queue<CollectChildData, void>(COLLECT_QUEUE, {
      connection,
    });
    processQueue = new Queue<ProcessParentData, RunProcessResult>(
      PROCESS_QUEUE,
      { connection },
    );
    processQueueEvents = new QueueEvents(PROCESS_QUEUE, { connection });
    flowProducer = new FlowProducer({ connection });

    collectionWorker = new Worker<CollectChildData, void>(
      COLLECT_QUEUE,
      async (job: Job<CollectChildData, void>) => {
        const { runId, sourceType, mode } = job.data;
        await runStateService.updateSource(runId, sourceType, {
          status: "running",
        });
        await runStateService.setStage(runId, "collecting");

        if (mode === "fail") {
          await runStateService.updateSource(runId, sourceType, {
            status: "failed",
            errors: ["simulated collector failure"],
          });
          throw new Error("simulated collector failure");
        }

        const now = new Date();
        const insert =
          mode === "seed-hn"
            ? [
                {
                  sourceType: "hn" as const,
                  externalId: "flow-hn-1",
                  title: "AI breakthrough headline",
                  url: "https://example.com/ai-breakthrough",
                  sourceUrl: "https://news.ycombinator.com/item?id=1",
                  author: "alice",
                  content: null,
                  publishedAt: now,
                  collectedAt: now,
                  engagement: { points: 250, commentCount: 30 },
                  metadata: { comments: [] },
                  updatedAt: now,
                },
                {
                  // Duplicate of flow-hn-1 by canonical URL (utm stripped).
                  sourceType: "hn" as const,
                  externalId: "flow-hn-1-dup",
                  title: "AI breakthrough headline (rehost)",
                  url: "https://example.com/ai-breakthrough?utm_source=x",
                  sourceUrl: "https://news.ycombinator.com/item?id=2",
                  author: "alice",
                  content: null,
                  publishedAt: now,
                  collectedAt: now,
                  engagement: { points: 80, commentCount: 5 },
                  metadata: { comments: [] },
                  updatedAt: now,
                },
                {
                  sourceType: "hn" as const,
                  externalId: "flow-hn-2",
                  title: "New transformer paper",
                  url: "https://example.com/transformer",
                  sourceUrl: "https://news.ycombinator.com/item?id=3",
                  author: "bob",
                  content: null,
                  publishedAt: now,
                  collectedAt: now,
                  engagement: { points: 180, commentCount: 22 },
                  metadata: { comments: [] },
                  updatedAt: now,
                },
              ]
            : [
                {
                  sourceType: "reddit" as const,
                  externalId: "flow-r-1",
                  title: "LocalLLaMA: new fine-tune",
                  url: "https://example.com/localllama-finetune",
                  sourceUrl: "https://reddit.com/r/LocalLLaMA/1",
                  author: "redditor",
                  content: null,
                  publishedAt: now,
                  collectedAt: now,
                  engagement: { points: 400, commentCount: 50 },
                  metadata: { comments: [] },
                  updatedAt: now,
                },
              ];

        await repo.upsertItems(insert);

        await runStateService.updateSource(runId, sourceType, {
          status: "completed",
          itemsFetched: insert.length,
        });
      },
      { connection },
    );

    processWorker = new Worker<ProcessParentData, RunProcessResult>(
      PROCESS_QUEUE,
      (job) =>
        handleRunProcessJob(
          {
            runState: runStateService,
            db,
            loadFn: loadCandidatesSince,
            rankFn: (candidates, options) => rankFnImpl(candidates, options),
          },
          job as unknown as RunProcessJobLike,
        ),
      { connection },
    );

    return async () => {
      await processWorker.close();
      await collectionWorker.close();
      await processQueueEvents.close();
      await processQueue.close();
      await collectionQueue.close();
      await flowProducer.close();
      await closeTestRedis();
    };
  });

  beforeEach(async () => {
    rankFnImpl = defaultRankFn;
    await truncateAll();
    await collectionQueue.obliterate({ force: true });
    await processQueue.obliterate({ force: true });
    const connection = getTestRedis();
    const keys = await connection.keys("run:run-flow-e2e-*");
    if (keys.length > 0) await connection.del(...keys);
  });

  async function seedRunState(runId: string, topN: number): Promise<void> {
    const connection = getTestRedis();
    const runStateService = createRunStateService(connection);
    const startedAt = new Date(Date.now() - 60 * 1000).toISOString();
    const initial: RunState = {
      id: runId,
      status: "running",
      stage: "queued",
      topN,
      startedAt,
      updatedAt: startedAt,
      completedAt: null,
      sources: {
        hn: { status: "pending", itemsFetched: 0, errors: [] },
        reddit: { status: "pending", itemsFetched: 0, errors: [] },
      },
      rankedItems: null,
      warnings: [],
      error: null,
    };
    await runStateService.set(initial);
  }

  it("REQ-001/REQ-040/REQ-070: full FlowProducer flow completes with HN+Reddit", { timeout: 60000 }, async () => {
    const runId = "run-flow-e2e-happy";
    await seedRunState(runId, 3);

    await flowProducer.add({
      name: "run-process",
      queueName: PROCESS_QUEUE,
      data: { runId, topN: 3, sourceTypes: ["hn", "reddit"] },
      children: [
        {
          name: "hn-collect",
          queueName: COLLECT_QUEUE,
          data: { runId, sourceType: "hn", mode: "seed-hn" },
        },
        {
          name: "reddit-collect",
          queueName: COLLECT_QUEUE,
          data: { runId, sourceType: "reddit", mode: "seed-reddit" },
        },
      ],
    });

    const connection = getTestRedis();
    const runStateService = createRunStateService(connection);
    const final = await pollUntilTerminal(
      () => runStateService.get(runId),
      45000,
    );

    expect(final.status).toBe("completed");
    expect(final.stage).toBe("completed");
    expect(final.completedAt).not.toBeNull();
    expect(final.rankedItems?.length).toBe(3);
    expect(final.sources.hn?.status).toBe("completed");
    expect(final.sources.reddit?.status).toBe("completed");
    expect(final.sources.hn?.itemsFetched).toBe(3);
    expect(final.sources.reddit?.itemsFetched).toBe(1);

    // Dedup: 3 HN rows seeded but two share canonical URL → 2 unique HN + 1 reddit = 3 candidates.
    // The deterministic rankFn returns all 3 with descending scores.
    const ids = (final.rankedItems ?? []).map((r) => r.rawItemId);
    expect(new Set(ids).size).toBe(3);

    // Raw items physically present in Postgres.
    const rows = await db.select().from(rawItems);
    expect(rows.length).toBe(4);
  });

  it("REQ-044: all collectors fail → run completes with empty rankedItems and warning", { timeout: 60000 }, async () => {
    const runId = "run-flow-e2e-allfail";
    await seedRunState(runId, 3);

    await flowProducer.add({
      name: "run-process",
      queueName: PROCESS_QUEUE,
      data: { runId, topN: 3, sourceTypes: ["hn", "reddit"] },
      children: [
        {
          name: "hn-collect",
          queueName: COLLECT_QUEUE,
          data: { runId, sourceType: "hn", mode: "fail" },
          opts: { attempts: 1 },
        },
        {
          name: "reddit-collect",
          queueName: COLLECT_QUEUE,
          data: { runId, sourceType: "reddit", mode: "fail" },
          opts: { attempts: 1 },
        },
      ],
    });

    const connection = getTestRedis();
    const runStateService = createRunStateService(connection);
    const final = await pollUntilTerminal(
      () => runStateService.get(runId),
      45000,
    );

    expect(final.status).toBe("completed");
    expect(final.stage).toBe("completed");
    expect(final.rankedItems).toEqual([]);
    expect(final.warnings).toContain("no items collected");
    expect(final.sources.hn?.status).toBe("failed");
    expect(final.sources.reddit?.status).toBe("failed");
  });

  it("REQ-080/REQ-085: rankFn receives deduped candidates and parent runs after children", { timeout: 60000 }, async () => {
    const runId = "run-flow-e2e-rankobs";
    await seedRunState(runId, 5);
    const rankSpy = vi.fn(rankFnImpl);
    rankFnImpl = rankSpy;

    await flowProducer.add({
      name: "run-process",
      queueName: PROCESS_QUEUE,
      data: { runId, topN: 5, sourceTypes: ["hn"] },
      children: [
        {
          name: "hn-collect",
          queueName: COLLECT_QUEUE,
          data: { runId, sourceType: "hn", mode: "seed-hn" },
        },
      ],
    });

    const connection = getTestRedis();
    const runStateService = createRunStateService(connection);
    const final = await pollUntilTerminal(
      () => runStateService.get(runId),
      45000,
    );

    expect(final.status).toBe("completed");
    expect(rankSpy).toHaveBeenCalledTimes(1);
    const [candidatesArg] = rankSpy.mock.calls[0];
    // 3 HN raw_items but two collapse via canonical URL → 2 deduped candidates.
    expect(candidatesArg.length).toBe(2);
  });
});
