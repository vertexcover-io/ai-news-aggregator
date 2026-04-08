# Phase 6: API auth middleware + /api/runs routes

> **Status:** pending
> **Depends on:** Phase 5
> **Traces to:** REQ-001–006, REQ-010–013, REQ-080, EDGE-003, EDGE-011, EDGE-012, EDGE-015

## Overview

First real API surface. Adds:
- MVP password auth middleware that guards protected routes
- `POST /api/runs` — validates payload, creates runId + Redis run-state seed, enqueues a BullMQ flow via `FlowProducer`, returns `{ runId }`
- `GET /api/runs/:runId` — reads run state; on `completed` status, hydrates `rankedItems[]` by joining against `raw_items`

## Library research note

Use **context7** for current `hono` middleware composition, `bullmq.FlowProducer`
usage, and `zod` request body validation patterns.

## Implementation

**Files to create:**
- `packages/api/src/middleware/auth.ts`
- `packages/api/src/routes/runs.ts`
- `packages/api/src/services/runs.ts`
- `packages/api/src/services/rank-hydration.ts`
- `packages/api/src/lib/flow.ts` — FlowProducer wrapper
- `packages/api/src/lib/validate.ts` — zod schemas for request bodies
- `packages/api/tests/e2e/runs.e2e.test.ts`

**Files to modify:**
- `packages/api/src/index.ts` — register routes and middleware
- `packages/api/package.json` — add `bullmq`, `ioredis`, `zod`
- `.env.example` — confirm `ADMIN_PASSWORD` present

### Auth middleware

Simple bearer-password check:

```typescript
import type { MiddlewareHandler } from "hono";

export function createPasswordAuth(password: string): MiddlewareHandler {
  return async (c, next) => {
    const header = c.req.header("Authorization") ?? "";
    const provided = header.startsWith("Bearer ") ? header.slice(7) : header;
    if (!provided || provided !== password) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  };
}
```

Wire it at the route-group level:

```typescript
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) throw new Error("ADMIN_PASSWORD is required");
app.use("/api/runs/*", createPasswordAuth(ADMIN_PASSWORD));
app.use("/api/runs", createPasswordAuth(ADMIN_PASSWORD));
```

### Request validation (`lib/validate.ts`)

```typescript
import { z } from "zod";

const hnConfigSchema = z.object({
  keywords: z.array(z.string()).optional(),
  pointsThreshold: z.number().int().min(0).optional(),
  sinceDays: z.number().int().min(1).max(30),
});

const redditConfigSchema = z.object({
  subreddits: z.array(z.string().min(1)).min(1),
  sort: z.enum(["hot", "new", "top"]).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  sinceDays: z.number().int().min(1).max(30),
});

export const runSubmitSchema = z.object({
  topN: z.number().int().min(1).max(50),
  hn: hnConfigSchema.optional(),
  reddit: redditConfigSchema.optional(),
  web: z.unknown().optional(), // present → rejected below
}).refine(
  (payload) => payload.hn !== undefined || payload.reddit !== undefined,
  { message: "at least one of hn, reddit is required" },
);

export type RunSubmitBody = z.infer<typeof runSubmitSchema>;
```

Scoping rule: if `body.web` is present, reject with 400 "web sources not yet
supported" **before** enqueueing (overrides REQ-003 for MVP).

### FlowProducer wrapper (`lib/flow.ts`)

```typescript
import { FlowProducer } from "bullmq";
import { createRedisConnection } from "@newsletter/shared";

let singleton: FlowProducer | null = null;
export function getFlowProducer(): FlowProducer {
  singleton ??= new FlowProducer({ connection: createRedisConnection() });
  return singleton;
}
```

### `services/runs.ts`

```typescript
import { randomUUID } from "node:crypto";
import IORedis from "ioredis";
import { createRedisConnection } from "@newsletter/shared";
import type { RunState, RunSubmitPayload } from "@newsletter/shared";
import { getFlowProducer } from "../lib/flow";

const TTL = 3600;

export interface CreatedRun {
  runId: string;
}

export async function createRun(payload: RunSubmitPayload, redis: IORedis = createRedisConnection()): Promise<CreatedRun> {
  const runId = randomUUID();
  const now = new Date().toISOString();
  const sources: RunState["sources"] = {};
  if (payload.hn) sources.hn = { status: "pending", itemsFetched: 0, errors: [] };
  if (payload.reddit) sources.reddit = { status: "pending", itemsFetched: 0, errors: [] };

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

  // Seed Redis
  await redis.set(`run:${runId}`, JSON.stringify(initial), "EX", TTL);

  // Build flow
  const sourceTypes: ("hn" | "reddit")[] = [];
  if (payload.hn) sourceTypes.push("hn");
  if (payload.reddit) sourceTypes.push("reddit");

  const children: unknown[] = [];
  if (payload.hn) {
    children.push({
      name: "hn-collect",
      queueName: "collection",
      data: { runId, config: { ...payload.hn } },
    });
  }
  if (payload.reddit) {
    children.push({
      name: "reddit-collect",
      queueName: "collection",
      data: { runId, config: { ...payload.reddit } },
    });
  }

  await getFlowProducer().add({
    name: "run-process",
    queueName: "processing",
    data: { runId, topN: payload.topN, sourceTypes },
    children: children as any,
  });

  return { runId };
}
```

### `services/rank-hydration.ts`

```typescript
import { inArray } from "drizzle-orm";
import type { AppDb, RankedItem, RankedItemRef } from "@newsletter/shared";
import { rawItems } from "@newsletter/shared/db/schema";

export async function hydrateRankedItems(
  db: AppDb,
  refs: RankedItemRef[],
): Promise<RankedItem[]> {
  if (refs.length === 0) return [];
  const ids = refs.map((r) => r.rawItemId);
  const rows = await db.select().from(rawItems).where(inArray(rawItems.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const hydrated: RankedItem[] = [];
  for (const ref of refs) {
    const row = byId.get(ref.rawItemId);
    if (!row) continue;
    hydrated.push({
      id: row.id,
      rawItemId: row.id,
      title: row.title,
      url: row.url,
      sourceType: row.sourceType,
      author: row.author,
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
      engagement: row.engagement,
      score: ref.score,
      rationale: ref.rationale,
    });
  }
  return hydrated;
}
```

### `routes/runs.ts`

```typescript
import { Hono } from "hono";
import { getDb, createLogger, createRedisConnection } from "@newsletter/shared";
import { runSubmitSchema } from "../lib/validate";
import { createRun } from "../services/runs";
import { hydrateRankedItems } from "../services/rank-hydration";

const logger = createLogger("api:runs");
const runs = new Hono();

runs.post("/", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  // Web deferral
  if (body && typeof body === "object" && "web" in body && (body as Record<string, unknown>).web !== undefined) {
    return c.json({ error: "web sources not yet supported" }, 400);
  }
  const parsed = runSubmitSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }
  const { runId } = await createRun(parsed.data);
  logger.info({ event: "run.started", runId, topN: parsed.data.topN, sources: Object.keys(parsed.data).filter((k) => k !== "topN") }, "run.started");
  return c.json({ runId }, 201);
});

runs.get("/:runId", async (c) => {
  const runId = c.req.param("runId");
  const redis = createRedisConnection();
  const raw = await redis.get(`run:${runId}`);
  if (!raw) return c.json({ error: "not found" }, 404);
  const state = JSON.parse(raw);
  if (state.status === "completed" && Array.isArray(state.rankedItems)) {
    const hydrated = await hydrateRankedItems(getDb(), state.rankedItems);
    return c.json({ ...state, rankedItems: hydrated });
  }
  return c.json(state);
});

export default runs;
```

Register in `index.ts`:

```typescript
app.use("/api/runs/*", createPasswordAuth(ADMIN_PASSWORD));
app.route("/api/runs", runs);
```

## What to test (integration, REQ-001–013, EDGE-011, EDGE-012)

Create `packages/api/tests/e2e/runs.e2e.test.ts` using Vitest with a real Redis
(via `pnpm infra:up`) and a mocked FlowProducer (to avoid actually running jobs
inside the api unit test). For end-to-end-with-real-flow, defer to Phase 8.

1. **REQ-001:** POST valid payload → 201 + `{ runId }`.
2. **REQ-002:** `topN: 0` → 400; `topN: 51` → 400; no source groups → 400.
3. **Web deferral:** `{ web: {...}, topN: 10, hn: {...} }` → 400 with "web sources not yet supported".
4. **REQ-004:** After POST, read `run:{runId}` from Redis → status "running",
   stage "queued", TTL between 3000 and 3600.
5. **REQ-005:** After POST, mock FlowProducer's `.add` to capture args; assert
   parent node `"run-process"` on `"processing"` queue and one child per source
   on `"collection"`.
6. **REQ-006:** POST without auth header → 401; with correct `Authorization:
   Bearer <pass>` → 201.
7. **REQ-010:** Seed a run-state key in Redis; GET returns 200 + full state.
8. **REQ-011:** GET `/api/runs/nonexistent` → 404.
9. **REQ-012:** Seed Redis with `status: "completed"` and a rankedItems ref;
   seed `raw_items` with matching row; GET returns hydrated item with all
   listed fields.
10. **REQ-013:** Seed `rankedItems: []` → GET returns empty array.
11. **EDGE-011:** POST with malformed JSON body → 400.
12. **EDGE-012:** GET `/api/runs/../etc/passwd` → 404 (Redis key doesn't match,
    no filesystem access).
13. **REQ-080:** Log assertion — POST emits `event: "run.started"` with runId.

**Commit:** `feat(VER-run-ui): add POST/GET /api/runs with auth middleware`

## Done When

- [ ] Auth middleware exists and is applied to `/api/runs/*`
- [ ] `POST /api/runs` validates, seeds Redis, enqueues flow, returns 201
- [ ] `GET /api/runs/:runId` reads state, hydrates on completed
- [ ] All 13 integration tests pass with real Redis
- [ ] bullmq, ioredis, zod added to @newsletter/api
