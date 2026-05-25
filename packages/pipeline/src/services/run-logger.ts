import type { Logger } from "@newsletter/shared/logger";
import type {
  RunLogContext,
  RunLogEvent,
  RunLogLevel,
} from "@newsletter/shared";
import type { RunLogRepo } from "@pipeline/repositories/run-logs.js";

export interface RunLogFields {
  stage: string;
  source?: string;
  event: RunLogEvent;
  [key: string]: unknown;
}

export type RunLogMethod = (
  fields: RunLogFields,
  message: string,
) => Promise<void>;

export interface RunLogger {
  debug: RunLogMethod;
  info: RunLogMethod;
  warn: RunLogMethod;
  error: RunLogMethod;
}

export interface RunLoggerDeps {
  repo: RunLogRepo;
  logger: Logger;
}

const RESERVED_KEYS = new Set(["stage", "source", "event"]);

function splitContext(fields: RunLogFields): RunLogContext | null {
  const context: RunLogContext = {};
  let hasAny = false;
  for (const [key, value] of Object.entries(fields)) {
    if (RESERVED_KEYS.has(key)) continue;
    context[key] = value;
    hasAny = true;
  }
  return hasAny ? context : null;
}

export function createRunLogger(
  runId: string,
  { repo, logger }: RunLoggerDeps,
): RunLogger {
  const emit = (level: RunLogLevel): RunLogMethod => {
    return async (fields, message) => {
      const { stage, source, event } = fields;
      const context = splitContext(fields);
      logger[level]({ runId, stage, source, event, ...context }, message);
      try {
        await repo.append(runId, {
          level,
          stage,
          source: source ?? null,
          event,
          message,
          context,
        });
      } catch (err) {
        logger.error(
          {
            event: "run_log.write_failed",
            runId,
            originalEvent: event,
            error: err instanceof Error ? err.message : String(err),
          },
          "run_log.write_failed",
        );
      }
    };
  };

  return {
    debug: emit("debug"),
    info: emit("info"),
    warn: emit("warn"),
    error: emit("error"),
  };
}
