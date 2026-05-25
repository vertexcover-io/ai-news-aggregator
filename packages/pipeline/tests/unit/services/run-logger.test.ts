import { describe, it, expect, vi } from "vitest";
import type { RunLogInsert } from "@newsletter/shared/types";
import type { Logger } from "@newsletter/shared/logger";
import {
  createRunLogger,
  type RunLogger,
} from "@pipeline/services/run-logger.js";
import type { RunLogRepo } from "@pipeline/repositories/run-logs.js";

interface FakeRepo {
  repo: RunLogRepo;
  appended: { runId: string; entry: RunLogInsert }[];
}

function makeFakeRepo(): FakeRepo {
  const appended: { runId: string; entry: RunLogInsert }[] = [];
  return {
    appended,
    repo: {
      append: vi.fn((runId: string, entry: RunLogInsert) => {
        appended.push({ runId, entry });
        return Promise.resolve();
      }),
    },
  };
}

function makeThrowingRepo(): RunLogRepo {
  return {
    append: vi.fn(() => Promise.reject(new Error("db is down"))),
  };
}

interface LoggerSpy {
  logger: Logger;
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
}

function makeLoggerSpy(): LoggerSpy {
  const debug = vi.fn();
  const info = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();
  return {
    debug,
    info,
    warn,
    error,
    logger: { debug, info, warn, error } as unknown as Logger,
  };
}

describe("createRunLogger", () => {
  // REQ-010
  it("writes exactly one run_logs row per call and still emits Pino", async () => {
    const fake = makeFakeRepo();
    const spy = makeLoggerSpy();
    const runLogger: RunLogger = createRunLogger("run-1", {
      repo: fake.repo,
      logger: spy.logger,
    });

    await runLogger.info(
      { stage: "collecting", event: "run.started", topN: 3 },
      "run.started",
    );

    expect(fake.appended).toHaveLength(1);
    expect(fake.appended[0].runId).toBe("run-1");
    expect(fake.appended[0].entry).toEqual({
      level: "info",
      stage: "collecting",
      source: null,
      event: "run.started",
      message: "run.started",
      context: { topN: 3 },
    });
    expect(spy.info).toHaveBeenCalledTimes(1);
  });

  // REQ-010: source threads through, context separated from routing fields
  it("threads source and routes non-reserved fields into context", async () => {
    const fake = makeFakeRepo();
    const spy = makeLoggerSpy();
    const runLogger = createRunLogger("run-2", {
      repo: fake.repo,
      logger: spy.logger,
    });

    await runLogger.error(
      {
        stage: "collecting",
        source: "twitter:@x",
        event: "source.failed",
        errors: ["boom"],
        durationMs: 12,
      },
      "source.failed",
    );

    expect(fake.appended[0].entry).toEqual({
      level: "error",
      stage: "collecting",
      source: "twitter:@x",
      event: "source.failed",
      message: "source.failed",
      context: { errors: ["boom"], durationMs: 12 },
    });
    expect(spy.error).toHaveBeenCalledTimes(1);
  });

  it("writes null context when no extra fields are present", async () => {
    const fake = makeFakeRepo();
    const spy = makeLoggerSpy();
    const runLogger = createRunLogger("run-3", {
      repo: fake.repo,
      logger: spy.logger,
    });

    await runLogger.warn(
      { stage: "ranking", event: "run.cancelled" },
      "run.cancelled",
    );

    expect(fake.appended[0].entry.context).toBeNull();
    expect(spy.warn).toHaveBeenCalledTimes(1);
  });

  it("emits the matching Pino level for each method", async () => {
    const fake = makeFakeRepo();
    const spy = makeLoggerSpy();
    const runLogger = createRunLogger("run-4", {
      repo: fake.repo,
      logger: spy.logger,
    });

    await runLogger.debug({ stage: "collecting", event: "run.started" }, "d");
    await runLogger.info({ stage: "collecting", event: "run.started" }, "i");
    await runLogger.warn({ stage: "collecting", event: "run.started" }, "w");
    await runLogger.error({ stage: "collecting", event: "run.failed" }, "e");

    expect(spy.debug).toHaveBeenCalledTimes(1);
    expect(spy.info).toHaveBeenCalledTimes(1);
    expect(spy.warn).toHaveBeenCalledTimes(1);
    expect(spy.error).toHaveBeenCalledTimes(1);
    expect(fake.appended).toHaveLength(4);
  });

  // REQ-016, EDGE-008: a throwing repo must not abort the caller
  it("does not throw and logs run_log.write_failed when the repo insert fails", async () => {
    const repo = makeThrowingRepo();
    const spy = makeLoggerSpy();
    const runLogger = createRunLogger("run-5", { repo, logger: spy.logger });

    await expect(
      runLogger.error(
        { stage: "ranking", event: "run.failed", stack: "Error: x" },
        "run.failed",
      ),
    ).resolves.toBeUndefined();

    // The intended Pino line still emitted (run.failed at error level)...
    expect(spy.error).toHaveBeenCalled();
    // ...plus a write_failed diagnostic.
    const writeFailed = spy.error.mock.calls.find(
      (c) => (c[0] as { event?: string }).event === "run_log.write_failed",
    );
    expect(writeFailed).toBeDefined();
  });

  // REQ-016: a subsequent insert is still attempted after a transient failure
  it("keeps attempting inserts after a prior insert throws", async () => {
    const calls: number[] = [];
    let n = 0;
    const repo: RunLogRepo = {
      append: vi.fn(() => {
        n += 1;
        calls.push(n);
        if (n === 1) return Promise.reject(new Error("transient"));
        return Promise.resolve();
      }),
    };
    const spy = makeLoggerSpy();
    const runLogger = createRunLogger("run-6", { repo, logger: spy.logger });

    await runLogger.info({ stage: "collecting", event: "run.started" }, "1");
    await runLogger.info({ stage: "processing", event: "stage.start" }, "2");

    expect(calls).toEqual([1, 2]);
  });
});
