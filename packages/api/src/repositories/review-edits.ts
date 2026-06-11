import { and, eq } from "drizzle-orm";
import { reviewEdits } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { ReviewEditRow } from "@newsletter/shared/review-edits";
import type { TenantContext } from "@newsletter/shared/types/tenant-context";

/** Minimal DB interface required by this repo — also satisfied by a Drizzle tx. */
type DbOrTx = Pick<AppDb, "select" | "insert" | "update" | "delete">;

export interface ReviewEditsRepo {
  /**
   * Replace all review_edits rows for the given runId with the provided rows.
   * Accepts an optional `tx` to run inside an existing Drizzle transaction.
   * When no `tx` is provided the operation runs in its own implicit transaction.
   */
  replaceForRun(runId: string, rows: ReviewEditRow[], tx?: DbOrTx): Promise<void>;
  listForRun(runId: string): Promise<ReviewEditRow[]>;
}

function dbRowToReviewEditRow(row: typeof reviewEdits.$inferSelect): ReviewEditRow {
  return {
    editType: row.editType,
    rawItemId: row.rawItemId ?? null,
    field: (row.field as ReviewEditRow["field"]) ?? null,
    before: row.before,
    after: row.after,
    positionBefore: row.positionBefore ?? null,
    positionAfter: row.positionAfter ?? null,
  };
}

export function createReviewEditsRepo(db: AppDb, ctx: TenantContext): ReviewEditsRepo {
  const runWhere = (runId: string) =>
    ctx.allTenants
      ? eq(reviewEdits.runId, runId)
      : and(eq(reviewEdits.runId, runId), eq(reviewEdits.tenantId, ctx.tenantId));

  return {
    async replaceForRun(runId, rows, tx) {
      const executor: DbOrTx = tx ?? db;
      await executor.delete(reviewEdits).where(runWhere(runId));
      if (rows.length > 0) {
        await executor.insert(reviewEdits).values(
          rows.map((r) => ({
            runId,
            tenantId: ctx.tenantId,
            editType: r.editType,
            rawItemId: r.rawItemId ?? undefined,
            field: r.field ?? undefined,
            before: r.before,
            after: r.after,
            positionBefore: r.positionBefore ?? undefined,
            positionAfter: r.positionAfter ?? undefined,
          })),
        );
      }
    },
    async listForRun(runId) {
      const rows = await db
        .select()
        .from(reviewEdits)
        .where(runWhere(runId))
        .orderBy(reviewEdits.id);
      return rows.map(dbRowToReviewEditRow);
    },
  };
}
