import { and, asc, eq } from "drizzle-orm";
import { runLogs } from "@newsletter/shared/db";
import type { AppDb, SourceType } from "@newsletter/shared/db";
import type { RunLogEntry } from "@newsletter/shared";

export interface RunLogSourceLookup {
  readonly sourceType: SourceType;
  readonly identifier: string;
}

export interface RunLogRepo {
  /** Returns all log rows for a run ordered by insertion order (id ascending) — REQ-026. */
  listForRun(runId: string): Promise<RunLogEntry[]>;
  listForRunSource(runId: string, source: RunLogSourceLookup): Promise<RunLogEntry[]>;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createRunLogRepo(
  db: Pick<AppDb, "select">,
  tenantId: string,
): RunLogRepo {
  return {
    async listForRun(runId: string): Promise<RunLogEntry[]> {
      if (!UUID_RE.test(runId)) return [];
      const rows = await selectLogs(db, tenantId, runId);
      return rows.map(toRunLogEntry);
    },
    async listForRunSource(
      runId: string,
      source: RunLogSourceLookup,
    ): Promise<RunLogEntry[]> {
      if (!UUID_RE.test(runId)) return [];
      const exactRows = await selectLogs(db, tenantId, runId, source.identifier);
      if (exactRows.length > 0) return exactRows.map(toRunLogEntry);

      if (source.identifier === source.sourceType) return [];
      const fallbackRows = await selectLogs(db, tenantId, runId, source.sourceType);
      return fallbackRows.map(toRunLogEntry);
    },
  };
}

const RUN_LOG_SELECT = {
  id: runLogs.id,
  runId: runLogs.runId,
  createdAt: runLogs.createdAt,
  level: runLogs.level,
  stage: runLogs.stage,
  source: runLogs.source,
  event: runLogs.event,
  message: runLogs.message,
  context: runLogs.context,
} as const;

interface RunLogSelectedRow {
  readonly id: number;
  readonly runId: string;
  readonly createdAt: Date;
  readonly level: RunLogEntry["level"];
  readonly stage: string;
  readonly source: string | null;
  readonly event: RunLogEntry["event"];
  readonly message: string;
  readonly context: RunLogEntry["context"];
}

function selectLogs(
  db: Pick<AppDb, "select">,
  tenantId: string,
  runId: string,
  source?: string,
): Promise<RunLogSelectedRow[]> {
  const runPredicate = and(
    eq(runLogs.tenantId, tenantId),
    eq(runLogs.runId, runId),
  );
  const predicate =
    source === undefined
      ? runPredicate
      : and(runPredicate, eq(runLogs.source, source));

  return db
    .select(RUN_LOG_SELECT)
    .from(runLogs)
    .where(predicate)
    .orderBy(asc(runLogs.id));
}

function toRunLogEntry(row: RunLogSelectedRow): RunLogEntry {
  return {
    id: row.id,
    runId: row.runId,
    ts: row.createdAt.toISOString(),
    level: row.level,
    stage: row.stage,
    source: row.source,
    event: row.event,
    message: row.message,
    context: row.context,
  };
}
