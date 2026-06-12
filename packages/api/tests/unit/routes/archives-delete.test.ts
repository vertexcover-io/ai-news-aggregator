import { describe, it, expect, vi } from "vitest";
import { setTestTenant } from "../../helpers/tenant.js";
import { Hono } from "hono";
import type IORedis from "ioredis";
import type { createLogger } from "@newsletter/shared";
import { createAdminArchivesRouter } from "@api/routes/archives.js";
import type { RawItemsRepo } from "@api/repositories/raw-items.js";
import type { RunArchivesRepo } from "@api/repositories/run-archives.js";

type AppLogger = ReturnType<typeof createLogger>;

const VALID_UUID = "11111111-2222-4333-8444-555555555555";

interface DeleteResult {
  deleted: boolean;
  removedEmailSends: number;
}

function makeArchiveRepo(result: DeleteResult): {
  repo: RunArchivesRepo;
  deleteSpy: ReturnType<typeof vi.fn>;
} {
  const deleteSpy = vi.fn(() => Promise.resolve(result));
  const repo = {
    findById: vi.fn(),
    list: vi.fn(),
    listReviewed: vi.fn(),
    updateRankedItems: vi.fn(),
    findPoolItems: vi.fn(),
    delete: deleteSpy,
  } as unknown as RunArchivesRepo;
  return { repo, deleteSpy };
}

function makeRawRepo(): RawItemsRepo {
  return { findByIds: vi.fn(() => Promise.resolve([])) };
}

interface Logger {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  fatal: ReturnType<typeof vi.fn>;
  trace: ReturnType<typeof vi.fn>;
  child: () => Logger;
}

function makeLogger(): Logger {
  const logger: Logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: () => logger,
  };
  return logger;
}

interface BuildOpts {
  archiveRepo: RunArchivesRepo;
  redis?: Pick<IORedis, "del">;
  logger?: Logger;
}

function buildApp(opts: BuildOpts): Hono {
  const app = new Hono();
  app.use("*", setTestTenant());
  const router = createAdminArchivesRouter({
    getArchiveRepo: () => opts.archiveRepo,
    getRawItemsRepo: () => makeRawRepo(),
    redis: opts.redis,
    logger: opts.logger as unknown as AppLogger,
  });
  app.route("/api/admin/archives", router);
  return app;
}

describe("DELETE /api/admin/archives/:runId", () => {
  it("REQ-7/REQ-10/REQ-11: returns 204 on successful delete and cleans Redis + logs event", async () => {
    const { repo, deleteSpy } = makeArchiveRepo({
      deleted: true,
      removedEmailSends: 3,
    });
    const del = vi.fn(() => Promise.resolve(1));
    const redis = { del } as unknown as Pick<IORedis, "del">;
    const logger = makeLogger();
    const app = buildApp({ archiveRepo: repo, redis, logger });

    const res = await app.request(`/api/admin/archives/${VALID_UUID}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(204);
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith(VALID_UUID);
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith(`run:${VALID_UUID}`);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "archive.deleted",
        runId: VALID_UUID,
        removedEmailSends: 3,
      }),
      expect.any(String),
    );
  });

  it("returns 204 and removes the Redis key when the archive row is absent but the Redis key exists (ghost cleanup)", async () => {
    const { repo } = makeArchiveRepo({ deleted: false, removedEmailSends: 0 });
    const del = vi.fn(() => Promise.resolve(1));
    const redis = { del } as unknown as Pick<IORedis, "del">;
    const logger = makeLogger();
    const app = buildApp({ archiveRepo: repo, redis, logger });

    const res = await app.request(`/api/admin/archives/${VALID_UUID}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(204);
    expect(del).toHaveBeenCalledWith(`run:${VALID_UUID}`);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "archive.deleted.ghost_cleanup",
        runId: VALID_UUID,
      }),
      expect.any(String),
    );
  });

  it("returns 404 when both the archive row and the Redis key are absent", async () => {
    const { repo } = makeArchiveRepo({ deleted: false, removedEmailSends: 0 });
    const del = vi.fn(() => Promise.resolve(0));
    const redis = { del } as unknown as Pick<IORedis, "del">;
    const app = buildApp({ archiveRepo: repo, redis });

    const res = await app.request(`/api/admin/archives/${VALID_UUID}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(404);
    expect(del).toHaveBeenCalledWith(`run:${VALID_UUID}`);
  });

  it("REQ-7: returns 400 for non-UUID runId and never calls repo.delete", async () => {
    const { repo, deleteSpy } = makeArchiveRepo({
      deleted: true,
      removedEmailSends: 0,
    });
    const app = buildApp({ archiveRepo: repo });

    const res = await app.request(`/api/admin/archives/not-a-uuid`, {
      method: "DELETE",
    });

    expect(res.status).toBe(400);
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("REQ-10: still returns 204 when redis.del throws and logs a warning", async () => {
    const { repo } = makeArchiveRepo({ deleted: true, removedEmailSends: 0 });
    const del = vi.fn(() => Promise.reject(new Error("redis down")));
    const redis = { del } as unknown as Pick<IORedis, "del">;
    const logger = makeLogger();
    const app = buildApp({ archiveRepo: repo, redis, logger });

    const res = await app.request(`/api/admin/archives/${VALID_UUID}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(204);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "archive.deleted.redis_cleanup_failed",
        runId: VALID_UUID,
      }),
      expect.any(String),
    );
  });

  it("returns 204 even when no redis dep is wired (best-effort)", async () => {
    const { repo } = makeArchiveRepo({ deleted: true, removedEmailSends: 0 });
    const app = buildApp({ archiveRepo: repo });

    const res = await app.request(`/api/admin/archives/${VALID_UUID}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(204);
  });
});
