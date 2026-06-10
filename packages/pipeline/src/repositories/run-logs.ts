import { isAllTenants, type ScopedTenantContext } from "@newsletter/shared/services";
import { runLogs } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { RunLogInsert } from "@newsletter/shared";

export interface RunLogRepo {
  /**
   * Append a single run_logs row. Pure INSERT — no precondition (the row is
   * append-only and never updated). Callers wrap this in best-effort error
   * handling (see services/run-logger.ts) so a failed insert never aborts the run.
   */
  append(runId: string, entry: RunLogInsert): Promise<void>;
}

export function createRunLogRepo(
  db: Pick<AppDb, "insert">,
  scoped: ScopedTenantContext,
): RunLogRepo {
  return {
    async append(runId: string, entry: RunLogInsert): Promise<void> {
      await db.insert(runLogs).values({
        runId,
        level: entry.level,
        stage: entry.stage,
        source: entry.source,
        event: entry.event,
        message: entry.message,
        context: entry.context,
      });
    },
  };
}
