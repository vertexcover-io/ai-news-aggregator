import { and, desc, eq, sql } from "drizzle-orm";
import { isAllTenants, type ScopedTenantContext, BOOTSTRAP_CONTEXT } from "@newsletter/shared/services";
import { evalRuns } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type {
  EvalRun,
  EvalRunInsertInput,
  EvalRunStatus,
  EvalRunSummary,
} from "@newsletter/shared/types/eval-ranking";

const ERROR_MESSAGE_MAX_LEN = 512;

export interface EvalRunListOptions {
  page: number;
  perPage: number;
  mode?: "scored" | "ab";
  status?: EvalRunStatus;
  fixtureId?: string;
}

export interface EvalRunListResult {
  runs: EvalRunSummary[];
  total: number;
}

export interface EvalRunsRepo {
  insert(input: EvalRunInsertInput): Promise<{ id: string }>;
  /**
   * Partial UPDATE. Requires the row to exist; callers must INSERT first on
   * paths where the row may not exist. Returns rowsAffected so silent no-ops
   * can be detected.
   */
  updateFinish(
    id: string,
    payload: { scoreBreakdown: unknown; costBreakdown: unknown },
  ): Promise<{ rowsAffected: number }>;
  /**
   * Partial UPDATE. Requires the row to exist; callers must INSERT first on
   * paths where the row may not exist. Returns rowsAffected so silent no-ops
   * can be detected.
   */
  updateFailed(
    id: string,
    payload: { errorMessage: string },
  ): Promise<{ rowsAffected: number }>;
  getById(id: string): Promise<EvalRun | null>;
  list(opts: EvalRunListOptions): Promise<EvalRunListResult>;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function assertMode(mode: string): "scored" | "ab" {
  if (mode === "scored" || mode === "ab") return mode;
  throw new Error(`Invalid eval_runs.mode: ${mode}`);
}

function assertStatus(status: string): EvalRunStatus {
  if (status === "running" || status === "done" || status === "failed") {
    return status;
  }
  throw new Error(`Invalid eval_runs.status: ${status}`);
}

interface EvalRunRow {
  id: string;
  mode: string;
  fixtureId: string | null;
  date: string | null;
  windowSize: number | null;
  draftPromptHash: string;
  draftPromptSnapshot: string;
  savedPromptHash: string | null;
  savedPromptSnapshot: string | null;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  scoreBreakdown: unknown;
  costBreakdown: unknown;
  errorMessage: string | null;
}

function mapRowToEvalRun(row: EvalRunRow): EvalRun {
  const startedAtIso = toIso(row.startedAt);
  if (startedAtIso === null) {
    throw new Error(`eval_runs row ${row.id} has null started_at`);
  }
  return {
    id: row.id,
    mode: assertMode(row.mode),
    fixtureId: row.fixtureId,
    date: row.date,
    windowSize: row.windowSize,
    draftPromptHash: row.draftPromptHash,
    draftPromptSnapshot: row.draftPromptSnapshot,
    savedPromptHash: row.savedPromptHash,
    savedPromptSnapshot: row.savedPromptSnapshot,
    status: assertStatus(row.status),
    startedAt: startedAtIso,
    finishedAt: toIso(row.finishedAt),
    scoreBreakdown: row.scoreBreakdown ?? null,
    costBreakdown: row.costBreakdown ?? null,
    errorMessage: row.errorMessage,
  };
}

function toSummary(run: EvalRun): EvalRunSummary {
  const {
    draftPromptSnapshot: _omit1,
    savedPromptSnapshot: _omit2,
    ...rest
  } = run;
  void _omit1;
  void _omit2;
  return rest;
}

export function createEvalRunsRepo(
  db: Pick<AppDb, "insert" | "select" | "update">, scoped: ScopedTenantContext,
): EvalRunsRepo {
  return {
    async insert(input: EvalRunInsertInput): Promise<{ id: string }> {
      const [row] = await db
        .insert(evalRuns)
        .values({
          mode: input.mode,
          fixtureId: input.fixtureId,
          date: input.date,
          windowSize: input.windowSize,
          draftPromptHash: input.draftPromptHash,
          draftPromptSnapshot: input.draftPromptSnapshot,
          savedPromptHash: input.savedPromptHash,
          savedPromptSnapshot: input.savedPromptSnapshot,
          status: "running",
        })
        .returning({ id: evalRuns.id });
      return { id: row.id };
    },

    async updateFinish(
      id: string,
      payload: { scoreBreakdown: unknown; costBreakdown: unknown },
    ): Promise<{ rowsAffected: number }> {
      if (!UUID_RE.test(id)) return { rowsAffected: 0 };
      const rows = await db
        .update(evalRuns)
        .set({
          status: "done",
          finishedAt: new Date(),
          scoreBreakdown: payload.scoreBreakdown,
          costBreakdown: payload.costBreakdown,
        })
        .where(eq(evalRuns.id, id))
        .returning({ id: evalRuns.id });
      return { rowsAffected: rows.length };
    },

    async updateFailed(
      id: string,
      payload: { errorMessage: string },
    ): Promise<{ rowsAffected: number }> {
      if (!UUID_RE.test(id)) return { rowsAffected: 0 };
      const truncated = payload.errorMessage.slice(0, ERROR_MESSAGE_MAX_LEN);
      const rows = await db
        .update(evalRuns)
        .set({
          status: "failed",
          finishedAt: new Date(),
          errorMessage: truncated,
        })
        .where(eq(evalRuns.id, id))
        .returning({ id: evalRuns.id });
      return { rowsAffected: rows.length };
    },

    async getById(id: string): Promise<EvalRun | null> {
      if (!UUID_RE.test(id)) return null;
      const rows = await db
        .select()
        .from(evalRuns)
        .where(eq(evalRuns.id, id));
      if (rows.length === 0) return null;
      return mapRowToEvalRun(rows[0]);
    },

    async list(opts: EvalRunListOptions): Promise<EvalRunListResult> {
      const filters = [];
      if (opts.mode !== undefined) filters.push(eq(evalRuns.mode, opts.mode));
      if (opts.status !== undefined)
        filters.push(eq(evalRuns.status, opts.status));
      if (opts.fixtureId !== undefined)
        filters.push(eq(evalRuns.fixtureId, opts.fixtureId));
      const whereClause = filters.length > 0 ? and(...filters) : undefined;

      const offset = (opts.page - 1) * opts.perPage;

      const baseRows = db.select().from(evalRuns).$dynamic();
      const rowsQuery = whereClause ? baseRows.where(whereClause) : baseRows;
      const rows = await rowsQuery
        .orderBy(desc(evalRuns.startedAt))
        .limit(opts.perPage)
        .offset(offset);

      const baseCount = db
        .select({ count: sql<number>`count(*)::int` })
        .from(evalRuns)
        .$dynamic();
      const countRows = await (whereClause
        ? baseCount.where(whereClause)
        : baseCount);
      const total = countRows[0]?.count ?? 0;

      return {
        runs: rows.map((r) => toSummary(mapRowToEvalRun(r))),
        total,
      };
    },
  };
}
