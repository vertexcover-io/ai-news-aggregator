import { Hono } from "hono";
import { createLogger, getDb as defaultGetDb } from "@newsletter/shared";
import { buildSourcesSummary } from "@api/services/sources-summary.js";
import {
  createRawItemsRepo,
  type RawItemsRepo,
} from "@api/repositories/raw-items.js";
import {
  createRunArchivesRepo,
  type RunArchivesRepo,
} from "@api/repositories/run-archives.js";
import {
  createUserSettingsRepo,
  type UserSettingsRepo,
} from "@api/repositories/user-settings.js";

export interface SourcesRouterDeps {
  getRawItemsRepo: () => RawItemsRepo;
  getArchiveRepo: () => RunArchivesRepo;
  getSettingsRepo: () => UserSettingsRepo;
  logger?: ReturnType<typeof createLogger>;
  now?: () => Date;
}

const MAX_RANGE_MS = 365 * 24 * 60 * 60 * 1000;
const DEFAULT_RANGE_MS = 7 * 24 * 60 * 60 * 1000;

interface ResolvedRange {
  from: Date;
  to: Date;
}

interface RangeResult {
  ok: true;
  range: ResolvedRange;
}

interface RangeError {
  ok: false;
  message: string;
}

function resolveRange(
  fromParam: string | undefined,
  toParam: string | undefined,
  now: Date,
): RangeResult | RangeError {
  const to = toParam ? new Date(toParam) : now;
  if (Number.isNaN(to.getTime())) {
    return { ok: false, message: "invalid 'to' date" };
  }
  const from = fromParam
    ? new Date(fromParam)
    : new Date(to.getTime() - DEFAULT_RANGE_MS);
  if (Number.isNaN(from.getTime())) {
    return { ok: false, message: "invalid 'from' date" };
  }
  if (from.getTime() >= to.getTime()) {
    return { ok: false, message: "'from' must be before 'to'" };
  }
  const clampedTo = to.getTime() > now.getTime() ? now : to;
  const earliest = new Date(clampedTo.getTime() - MAX_RANGE_MS);
  const clampedFrom = from < earliest ? earliest : from;
  return { ok: true, range: { from: clampedFrom, to: clampedTo } };
}

export function createPublicSourcesRouter(deps: SourcesRouterDeps): Hono {
  const logger = deps.logger ?? createLogger("api:sources");
  const sources = new Hono();

  sources.get("/summary", async (c) => {
    const now = deps.now?.() ?? new Date();
    const r = resolveRange(
      c.req.query("from"),
      c.req.query("to"),
      now,
    );
    if (!r.ok) {
      return c.json({ error: r.message }, 400);
    }
    try {
      const summary = await buildSourcesSummary({
        rawItemsRepo: deps.getRawItemsRepo(),
        runArchivesRepo: deps.getArchiveRepo(),
        userSettingsRepo: deps.getSettingsRepo(),
        from: r.range.from,
        to: r.range.to,
        now: deps.now,
      });
      return c.json(summary);
    } catch (err) {
      logger.error({ err }, "sources.summary_failed");
      return c.json({ error: "internal error" }, 500);
    }
  });

  return sources;
}

export function createDefaultPublicSourcesRouter(): Hono {
  return createPublicSourcesRouter({
    getRawItemsRepo: () => createRawItemsRepo(defaultGetDb()),
    getArchiveRepo: () => createRunArchivesRepo(defaultGetDb()),
    getSettingsRepo: () => createUserSettingsRepo(defaultGetDb()),
  });
}
