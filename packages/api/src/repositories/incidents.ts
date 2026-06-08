/**
 * API IncidentRepository implementation (REQ-026).
 *
 * Drizzle ORM access is ONLY allowed in src/repositories/** — enforced by
 * newsletter/enforce-repository-access. The shared dispatcher depends on the
 * IncidentRepository interface; it must NOT import drizzle-orm.
 *
 * Mirrors packages/pipeline/src/repositories/incidents.ts exactly for the
 * shared methods (same convention as run-logs existing in both packages).
 */
import { sql, and, eq, isNull, lt, inArray, desc } from "drizzle-orm";
import { incidents } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import { fingerprintFor } from "@newsletter/shared/alerting";
import type {
  CaptureIncidentInput,
  Incident,
  IncidentListFilter,
  IncidentRepository,
  IncidentStatus,
  UpsertResult,
} from "@newsletter/shared/alerting";
import {
  ALERT_SWEEP_BATCH_SIZE,
  ALERT_MAX_DELIVERY_ATTEMPTS,
} from "@newsletter/shared";

/**
 * Create the API IncidentRepository backed by Postgres via Drizzle.
 */
export function createIncidentRepo(db: AppDb): IncidentRepository {
  return {
    /**
     * Upsert by fingerprint with ON CONFLICT.
     *
     * REQ-009: dedup — two captures with the same fingerprint → one row, occurrences++.
     * REQ-011: `shouldNotify` is computed from the PRE-UPDATE `notified_at` value.
     *          We capture the old row's notified_at in a CTE BEFORE the update runs.
     *
     * SQL strategy: use a raw SQL expression to implement the cooldown logic and
     * capture the pre-update state.
     */
    async upsertByFingerprint(
      input: CaptureIncidentInput,
      cooldownMs: number,
    ): Promise<UpsertResult> {
      const fingerprint = fingerprintFor(input.category, input.source, undefined);

      // Use a CTE to read the existing row's notified_at BEFORE the upsert
      // (required for REQ-011: cooldown computed from pre-update value).
      const rows = await db.execute<{
        id: string;
        status: string;
        is_new: boolean;
        should_notify: boolean;
      }>(sql`
        WITH
          pre AS (
            SELECT notified_at, status
            FROM incidents
            WHERE fingerprint = ${fingerprint}
          ),
          upserted AS (
            INSERT INTO incidents (
              fingerprint,
              severity,
              category,
              title,
              message,
              source,
              run_id,
              context
            )
            VALUES (
              ${fingerprint},
              ${input.severity},
              ${input.category},
              ${input.title},
              ${input.message},
              ${input.source ?? null},
              ${input.runId ?? null},
              ${JSON.stringify(input.context ?? {})}::jsonb
            )
            ON CONFLICT (fingerprint) DO UPDATE
              SET occurrences  = incidents.occurrences + 1,
                  last_seen_at = now(),
                  severity     = EXCLUDED.severity,
                  message      = EXCLUDED.message
            RETURNING
              id,
              status,
              (xmax = 0) AS is_new
          )
        SELECT
          u.id,
          u.status,
          u.is_new,
          (
            u.is_new
            OR (
              u.status = 'open'
              AND (
                p.notified_at IS NULL
                OR p.notified_at < now() - (${cooldownMs}::bigint * INTERVAL '1 millisecond')
              )
            )
          ) AS should_notify
        FROM upserted u
        LEFT JOIN pre p ON true
      `);

      const row = rows[0];

      return {
        id: row.id,
        isNew: row.is_new,
        shouldNotify: row.should_notify,
        status: row.status as UpsertResult["status"],
      };
    },

    /**
     * Mark a delivered incident (guarded — only if notified_at IS NULL).
     * EDGE-006: at most one send wins the race under concurrent marks.
     */
    async markDelivered(id: string, deliveredAt: Date): Promise<void> {
      await db
        .update(incidents)
        .set({ notifiedAt: deliveredAt })
        .where(and(eq(incidents.id, id), isNull(incidents.notifiedAt)));
    },

    /**
     * Increment delivery_attempts on a failed send (REQ-014).
     * Does NOT set notified_at.
     */
    async incrementDeliveryAttempts(id: string): Promise<void> {
      await db
        .update(incidents)
        .set({ deliveryAttempts: sql`${incidents.deliveryAttempts} + 1` })
        .where(eq(incidents.id, id));
    },

    /**
     * List undelivered incidents for the delivery sweep (REQ-015/016).
     *
     * Selects open, undelivered, below-cap rows bounded by ALERT_SWEEP_BATCH_SIZE.
     */
    async listUndelivered(): Promise<Incident[]> {
      const rows = await db
        .select()
        .from(incidents)
        .where(
          and(
            inArray(incidents.severity, ["warning", "error", "critical"]),
            isNull(incidents.notifiedAt),
            eq(incidents.status, "open"),
            lt(incidents.deliveryAttempts, ALERT_MAX_DELIVERY_ATTEMPTS),
          ),
        )
        .orderBy(incidents.firstSeenAt)
        .limit(ALERT_SWEEP_BATCH_SIZE);

      return rows.map(rowToIncident);
    },

    /**
     * List incidents for the admin UI (REQ-020).
     *
     * Optionally filter by status and/or severity.
     * Order: last_seen_at DESC (newest first).
     */
    async list(filter?: IncidentListFilter): Promise<Incident[]> {
      const conditions = [];
      if (filter?.status !== undefined) {
        conditions.push(eq(incidents.status, filter.status));
      }
      if (filter?.severity !== undefined) {
        conditions.push(eq(incidents.severity, filter.severity));
      }

      const rows = await db
        .select()
        .from(incidents)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(incidents.lastSeenAt));

      return rows.map(rowToIncident);
    },

    /**
     * Update an incident's status (REQ-021).
     *
     * Returns the updated incident, or null if not found.
     */
    async setStatus(id: string, status: IncidentStatus): Promise<Incident | null> {
      const rows = await db
        .update(incidents)
        .set({ status })
        .where(eq(incidents.id, id))
        .returning();

      if (rows.length === 0) return null;

      return rowToIncident(rows[0]);
    },
  };
}

function rowToIncident(r: {
  id: string;
  fingerprint: string;
  severity: Incident["severity"];
  category: Incident["category"];
  title: string;
  message: string;
  source: string | null;
  runId: string | null;
  context: Incident["context"];
  status: Incident["status"];
  occurrences: number;
  deliveryAttempts: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  notifiedAt: Date | null;
}): Incident {
  return {
    id: r.id,
    fingerprint: r.fingerprint,
    severity: r.severity,
    category: r.category,
    title: r.title,
    message: r.message,
    source: r.source ?? null,
    runId: r.runId ?? null,
    context: r.context,
    status: r.status,
    occurrences: r.occurrences,
    deliveryAttempts: r.deliveryAttempts,
    firstSeenAt: r.firstSeenAt,
    lastSeenAt: r.lastSeenAt,
    notifiedAt: r.notifiedAt ?? null,
  };
}
