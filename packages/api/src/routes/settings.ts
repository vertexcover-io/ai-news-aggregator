import { Hono } from "hono";
import type { Queue } from "bullmq";
import {
  createLogger,
  createRedisConnection,
  getDb as defaultGetDb,
} from "@newsletter/shared";
import type { RunProcessJobPayload } from "@newsletter/shared";
import { Queue as BullQueue } from "bullmq";
import { userSettingsUpsertSchema } from "@api/lib/validate.js";
import {
  createUserSettingsRepo,
  type UserSettingsRepo,
} from "@api/repositories/user-settings.js";
import { reconcileDailyRunSchedule } from "@api/services/scheduler.js";

export interface SettingsRouterDeps {
  getSettingsRepo: () => UserSettingsRepo;
  processingQueue: Pick<
    Queue,
    "upsertJobScheduler" | "removeJobScheduler"
  >;
  logger?: ReturnType<typeof createLogger>;
}

export function createSettingsRouter(deps: SettingsRouterDeps): Hono {
  const logger = deps.logger ?? createLogger("api:settings");
  const app = new Hono();

  app.get("/", async (c) => {
    const settings = await deps.getSettingsRepo().get();
    return c.json(settings);
  });

  app.put("/", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }

    const parsed = userSettingsUpsertSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.message, issues: parsed.error.issues },
        400,
      );
    }

    const saved = await deps.getSettingsRepo().upsert(parsed.data);
    await reconcileDailyRunSchedule(deps.processingQueue, saved);
    logger.info(
      {
        event: "settings.saved",
        scheduleEnabled: saved.scheduleEnabled,
        scheduleTime: saved.scheduleTime,
        scheduleTimezone: saved.scheduleTimezone,
      },
      "settings.saved",
    );
    return c.json(saved);
  });

  return app;
}

let defaultProcessingQueue: Queue<RunProcessJobPayload> | null = null;
function getDefaultProcessingQueue(): Queue<RunProcessJobPayload> {
  defaultProcessingQueue ??= new BullQueue<RunProcessJobPayload>("processing", {
    connection: createRedisConnection(),
  });
  return defaultProcessingQueue;
}

export function createDefaultSettingsRouter(): Hono {
  return createSettingsRouter({
    getSettingsRepo: () => createUserSettingsRepo(defaultGetDb()),
    processingQueue: getDefaultProcessingQueue(),
  });
}
