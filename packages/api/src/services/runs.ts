import { randomUUID } from "node:crypto";
import type IORedis from "ioredis";
import type { FlowChildJob, FlowProducer } from "bullmq";
import { createRedisConnection } from "@newsletter/shared";
import type { RunState, RunSubmitPayload } from "@newsletter/shared";
import { getFlowProducer } from "../lib/flow.js";

const TTL_SECONDS = 3600;

export interface CreatedRun {
  runId: string;
}

export async function createRun(
  payload: RunSubmitPayload,
  redis: IORedis = createRedisConnection(),
  flowProducer: FlowProducer = getFlowProducer(),
): Promise<CreatedRun> {
  const runId = randomUUID();
  const now = new Date().toISOString();
  const sources: RunState["sources"] = {};
  if (payload.hn) {
    sources.hn = { status: "pending", itemsFetched: 0, errors: [] };
  }
  if (payload.reddit) {
    sources.reddit = { status: "pending", itemsFetched: 0, errors: [] };
  }

  const initial: RunState = {
    id: runId,
    status: "running",
    stage: "queued",
    topN: payload.topN,
    startedAt: now,
    updatedAt: now,
    completedAt: null,
    sources,
    rankedItems: null,
    warnings: [],
    error: null,
  };

  await redis.set(`run:${runId}`, JSON.stringify(initial), "EX", TTL_SECONDS);

  const sourceTypes: ("hn" | "reddit")[] = [];
  const children: FlowChildJob[] = [];
  if (payload.hn) {
    sourceTypes.push("hn");
    children.push({
      name: "hn-collect",
      queueName: "collection",
      data: { runId, config: { ...payload.hn } },
    });
  }
  if (payload.reddit) {
    sourceTypes.push("reddit");
    children.push({
      name: "reddit-collect",
      queueName: "collection",
      data: { runId, config: { ...payload.reddit } },
    });
  }

  await flowProducer.add({
    name: "run-process",
    queueName: "processing",
    data: { runId, topN: payload.topN, sourceTypes },
    children,
  });

  return { runId };
}
