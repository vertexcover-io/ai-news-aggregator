import { asc, eq } from "drizzle-orm";
import { runLogs } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { RunLogEntry } from "@newsletter/shared";

export interface RunLogRepo {
  /** Returns all log rows for a run ordered by insertion order (id ascending) — REQ-026. */
  listForRun(runId: string): Promise<RunLogEntry[]>;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createRunLogRepo(db: Pick<AppDb, "select">): RunLogRepo {
  return {
    async listForRun(runId: string): Promise<RunLogEntry[]> {
      if (!UUID_RE.test(runId)) return [];
      const rows = await db
        .select({
          id: runLogs.id,
          runId: runLogs.runId,
          createdAt: runLogs.createdAt,
          level: runLogs.level,
          stage: runLogs.stage,
          source: runLogs.source,
          event: runLogs.event,
          message: runLogs.message,
          context: runLogs.context,
        })
        .from(runLogs)
        .where(eq(runLogs.runId, runId))
        .orderBy(asc(runLogs.id));

      return rows.map((r) => ({
        id: r.id,
        runId: r.runId,
        ts: r.createdAt.toISOString(),
        level: r.level,
        stage: r.stage,
        source: r.source,
        event: r.event,
        message: r.message,
        context: r.context,
      }));
    },
  };
}
