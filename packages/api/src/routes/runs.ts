import { Hono } from "hono";
import type IORedis from "ioredis";
import { Queue } from "bullmq";
import {
  createLogger,
  createRedisConnection,
  getDb as defaultGetDb,
} from "@newsletter/shared";
import type { RunState, UserProfile } from "@newsletter/shared";
import { runSubmitSchema } from "../lib/validate.js";
import { createRun } from "../services/runs.js";
import { hydrateRankedItems } from "../services/rank-hydration.js";
import {
  createRawItemsRepo,
  type RawItemsRepo,
} from "../repositories/raw-items.js";
import {
  loadProfile as defaultLoadProfile,
  ProfileNotFoundError,
  ProfileParseError,
} from "../services/profiles.js";

export interface RunsRouterDeps {
  redis: IORedis;
  processingQueue: Queue;
  getRawItemsRepo: () => RawItemsRepo;
  logger?: ReturnType<typeof createLogger>;
  loadProfile?: (name: string) => Promise<UserProfile>;
}

export function createRunsRouter(deps: RunsRouterDeps): Hono {
  const logger = deps.logger ?? createLogger("api:runs");
  const loadProfile = deps.loadProfile ?? defaultLoadProfile;
  const runs = new Hono();

  runs.post("/", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }

    const parsed = runSubmitSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }

    let profile: UserProfile | null = null;
    if (parsed.data.profileName != null) {
      try {
        profile = await loadProfile(parsed.data.profileName);
      } catch (err: unknown) {
        if (err instanceof ProfileNotFoundError) {
          return c.json({ error: err.message }, 400);
        }
        if (err instanceof ProfileParseError) {
          return c.json({ error: err.message }, 400);
        }
        throw err;
      }
    }

    const { runId } = await createRun(
      parsed.data,
      deps.redis,
      deps.processingQueue,
      { profile, halfLifeHours: parsed.data.halfLifeHours },
    );
    const sources = Object.keys(parsed.data).filter(
      (k) => k !== "topN" && k !== "profileName" && k !== "halfLifeHours",
    );
    logger.info(
      { event: "run.started", runId, topN: parsed.data.topN, sources },
      "run.started",
    );
    return c.json({ runId }, 201);
  });

  runs.get("/:runId", async (c) => {
    const runId = c.req.param("runId");
    const raw = await deps.redis.get(`run:${runId}`);
    if (raw === null) {
      return c.json({ error: "not found" }, 404);
    }
    const state = JSON.parse(raw) as RunState;
    if (state.status === "completed" && Array.isArray(state.rankedItems)) {
      const hydrated = await hydrateRankedItems(
        deps.getRawItemsRepo(),
        state.rankedItems,
      );
      return c.json({ ...state, rankedItems: hydrated });
    }
    return c.json(state);
  });

  return runs;
}

let defaultProcessingQueue: Queue | null = null;

function getDefaultProcessingQueue(): Queue {
  defaultProcessingQueue ??= new Queue("processing", {
    connection: createRedisConnection(),
  });
  return defaultProcessingQueue;
}

export function createDefaultRunsRouter(): Hono {
  return createRunsRouter({
    redis: createRedisConnection(),
    processingQueue: getDefaultProcessingQueue(),
    getRawItemsRepo: () => createRawItemsRepo(defaultGetDb()),
  });
}
