import { Hono } from "hono";
import type IORedis from "ioredis";
import type { FlowProducer } from "bullmq";
import {
  createLogger,
  createRedisConnection,
  getDb as defaultGetDb,
} from "@newsletter/shared";
import type { AppDb, RunState } from "@newsletter/shared";
import { runSubmitSchema } from "../lib/validate.js";
import { createRun } from "../services/runs.js";
import { hydrateRankedItems } from "../services/rank-hydration.js";
import { getFlowProducer } from "../lib/flow.js";

export interface RunsRouterDeps {
  redis: IORedis;
  flowProducer: FlowProducer;
  getDb: () => AppDb;
  logger?: ReturnType<typeof createLogger>;
}

export function createRunsRouter(deps: RunsRouterDeps): Hono {
  const logger = deps.logger ?? createLogger("api:runs");
  const runs = new Hono();

  runs.post("/", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }

    if (
      body !== null &&
      typeof body === "object" &&
      "web" in body &&
      (body as Record<string, unknown>).web !== undefined
    ) {
      return c.json({ error: "web sources not yet supported" }, 400);
    }

    const parsed = runSubmitSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }

    const { runId } = await createRun(parsed.data, deps.redis, deps.flowProducer);
    const sources = Object.keys(parsed.data).filter((k) => k !== "topN");
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
      const hydrated = await hydrateRankedItems(deps.getDb(), state.rankedItems);
      return c.json({ ...state, rankedItems: hydrated });
    }
    return c.json(state);
  });

  return runs;
}

export function createDefaultRunsRouter(): Hono {
  return createRunsRouter({
    redis: createRedisConnection(),
    flowProducer: getFlowProducer(),
    getDb: defaultGetDb,
  });
}
