import { describe, expect, it, vi } from "vitest";
import type { Logger } from "@newsletter/shared/logger";
import {
  withPinoBridge,
  type RunLogFields,
  type RunLogger,
} from "@pipeline/services/run-logger.js";

type Level = "debug" | "info" | "warn" | "error";

interface BaseLoggerHarness {
  logger: Logger;
  calls: Record<Level, [unknown, string][]>;
}

function makeBaseLogger(
  throwOn?: { level: Level; error: Error },
): BaseLoggerHarness {
  const calls: Record<Level, [unknown, string][]> = {
    debug: [],
    info: [],
    warn: [],
    error: [],
  };
  const make = (level: Level) =>
    (obj: unknown, msg: string): void => {
      if (throwOn?.level === level) {
        throw throwOn.error;
      }
      calls[level].push([obj, msg]);
    };
  const logger = {
    debug: make("debug"),
    info: make("info"),
    warn: make("warn"),
    error: make("error"),
  };
  return { logger: logger as unknown as Logger, calls };
}

interface RunLoggerHarness {
  runLogger: RunLogger;
  calls: Record<Level, [RunLogFields, string][]>;
}

function makeRunLogger(throwOn?: { level: Level; error: Error }): RunLoggerHarness {
  const calls: Record<Level, [RunLogFields, string][]> = {
    debug: [],
    info: [],
    warn: [],
    error: [],
  };
  const make = (level: Level) =>
    vi.fn((fields: RunLogFields, message: string): Promise<void> => {
      if (throwOn?.level === level) {
        return Promise.reject(throwOn.error);
      }
      calls[level].push([fields, message]);
      return Promise.resolve();
    });
  const runLogger: RunLogger = {
    debug: make("debug"),
    info: make("info"),
    warn: make("warn"),
    error: make("error"),
  };
  return { runLogger, calls };
}

describe("withPinoBridge", () => {
  const levels: Level[] = ["debug", "info", "warn", "error"];

  for (const level of levels) {
    it(`${level} calls both baseLogger.${level} and runLogger.${level} exactly once`, async () => {
      const base = makeBaseLogger();
      const run = makeRunLogger();
      const wrapped = withPinoBridge(run.runLogger, base.logger);
      const fields: RunLogFields = {
        stage: "collect",
        source: "blog",
        event: "link_enrichment.failed",
        url: "https://example.com/x",
      };
      await wrapped[level](fields, "hello");
      expect(base.calls[level]).toHaveLength(1);
      const baseCall = base.calls[level][0];
      expect(baseCall[0]).toEqual({
        stage: "collect",
        source: "blog",
        event: "link_enrichment.failed",
        url: "https://example.com/x",
      });
      expect(baseCall[1]).toBe("hello");
      expect(run.calls[level]).toHaveLength(1);
      const runCall = run.calls[level][0];
      expect(runCall[0]).toEqual(fields);
      expect(runCall[1]).toBe("hello");
    });
  }

  it("a throwing baseLogger.info does NOT prevent runLogger.info from being called", async () => {
    const base = makeBaseLogger({ level: "info", error: new Error("pino blew up") });
    const run = makeRunLogger();
    const wrapped = withPinoBridge(run.runLogger, base.logger);
    await expect(
      wrapped.info(
        { stage: "collect", event: "link_enrichment.failed" },
        "hi",
      ),
    ).resolves.toBeUndefined();
    expect(run.calls.info).toHaveLength(1);
  });

  it("a throwing runLogger.info (Promise rejection) is swallowed by the bridge", async () => {
    const base = makeBaseLogger();
    const run = makeRunLogger({ level: "info", error: new Error("repo append failed") });
    const wrapped = withPinoBridge(run.runLogger, base.logger);
    await expect(
      wrapped.info(
        { stage: "collect", event: "link_enrichment.failed" },
        "hi",
      ),
    ).resolves.toBeUndefined();
    expect(base.calls.info).toHaveLength(1);
    await expect(
      wrapped.info(
        { stage: "collect", event: "link_enrichment.failed" },
        "hi2",
      ),
    ).resolves.toBeUndefined();
    expect(base.calls.info).toHaveLength(2);
  });
});
