import { eq, sql } from "drizzle-orm";
import { errorIncidents, scopedTenantId } from "@newsletter/shared/db";
import type { AppDb, TenantScope } from "@newsletter/shared/db";
import type {
  ErrorIncidentRecord,
  IncidentRepo,
  IncidentStatus,
  UpsertIncidentInput,
  UpsertIncidentResult,
} from "@newsletter/shared/errors";
import type { ErrorIncidentRow } from "@newsletter/shared";

function toRecord(row: ErrorIncidentRow): ErrorIncidentRecord {
  return {
    fingerprint: row.fingerprint,
    category: row.category,
    fixability: row.fixability,
    sourcePackage: row.sourcePackage,
    status: row.status,
    occurrenceCount: row.occurrenceCount,
    githubRef: row.githubRef,
  };
}

/**
 * error_incidents repository. `upsertByFingerprint` is occurrence dedup: insert
 * a new incident or bump the count of an existing one. `isNew` is true for a
 * fresh fingerprint or a reopened (previously `resolved`) incident — that is the
 * signal the IncidentService uses to fire the universal Slack ping + lane action.
 */
export function createErrorIncidentsRepo(
  db: Pick<AppDb, "select" | "insert" | "update">,
  ctx?: TenantScope,
): IncidentRepo {
  async function bump(existing: ErrorIncidentRow): Promise<UpsertIncidentResult> {
    const reopen = existing.status === "resolved";
    const updated = await db
      .update(errorIncidents)
      .set({
        occurrenceCount: sql`${errorIncidents.occurrenceCount} + 1`,
        lastSeen: new Date(),
        ...(reopen ? { status: "open" as IncidentStatus } : {}),
      })
      .where(eq(errorIncidents.fingerprint, existing.fingerprint))
      .returning();
    return { incident: toRecord(updated.length > 0 ? updated[0] : existing), isNew: reopen };
  }

  return {
    async upsertByFingerprint(input: UpsertIncidentInput): Promise<UpsertIncidentResult> {
      const existing = await db
        .select()
        .from(errorIncidents)
        .where(eq(errorIncidents.fingerprint, input.fingerprint))
        .limit(1);
      if (existing.length > 0) return bump(existing[0]);

      try {
        const inserted = await db
          .insert(errorIncidents)
          .values({
            fingerprint: input.fingerprint,
            category: input.category,
            fixability: input.fixability,
            sourcePackage: input.sourcePackage,
            status: "open",
            context: input.context,
            posthogIssueUrl: input.posthogIssueUrl,
            tenantId: scopedTenantId(ctx),
          })
          .returning();
        if (inserted.length === 0) throw new Error("insert returned no row");
        return { incident: toRecord(inserted[0]), isNew: true };
      } catch {
        // Lost an insert race on the unique fingerprint — re-read and bump.
        const raced = await db
          .select()
          .from(errorIncidents)
          .where(eq(errorIncidents.fingerprint, input.fingerprint))
          .limit(1);
        if (raced.length === 0) throw new Error("upsert race: row vanished");
        return bump(raced[0]);
      }
    },

    async markStatus(
      fingerprint: string,
      status: IncidentStatus,
      githubRef?: string,
    ): Promise<void> {
      await db
        .update(errorIncidents)
        .set({ status, ...(githubRef !== undefined ? { githubRef } : {}) })
        .where(eq(errorIncidents.fingerprint, fingerprint));
    },
  };
}
