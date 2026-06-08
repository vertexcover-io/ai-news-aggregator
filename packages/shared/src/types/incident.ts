/**
 * Types for the centralized incident observability system.
 *
 * These types are intentionally free of drizzle-orm and DB imports (REQ-026 / D-100)
 * so they can be safely imported by the web frontend via a subpath export.
 */

export type IncidentSeverity = "critical" | "error" | "warning" | "info";

export type IncidentCategory =
  | "worker_crash"
  | "api_crash"
  | "job_failed"
  | "enrichment_failed"
  | "collector_failed"
  | "api_5xx"
  | "run_degraded"
  | "publish_partial_failure";

export type IncidentStatus = "open" | "resolved" | "muted";

/**
 * Flexible context bag for incident-specific metadata.
 * Kept as a plain record to avoid forcing callers to cast.
 */
export type IncidentContext = Record<string, unknown>;

/** The full incident row as returned from the DB. */
export interface Incident {
  id: string;
  fingerprint: string;
  severity: IncidentSeverity;
  category: IncidentCategory;
  title: string;
  message: string;
  source: string | null;
  runId: string | null;
  context: IncidentContext;
  status: IncidentStatus;
  occurrences: number;
  deliveryAttempts: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  notifiedAt: Date | null;
}

/** Input to captureIncident / the dispatcher. */
export interface CaptureIncidentInput {
  severity: IncidentSeverity;
  category: IncidentCategory;
  title: string;
  message: string;
  source?: string | undefined;
  runId?: string | undefined;
  context?: IncidentContext | undefined;
}

/**
 * Result returned by `upsertByFingerprint`.
 *
 * IMPORTANT (REQ-011): `shouldNotify` MUST be computed from the PRE-UPDATE
 * `notified_at` value (the value before the upsert runs), not from the
 * post-update `last_seen_at`. The repository implementation is responsible
 * for capturing the old row's `notified_at` before mutating it and using
 * that snapshot to decide whether the cooldown has elapsed.
 *
 * `notified_at` is only advanced when the dispatcher actually attempts a
 * Slack send (after observing `shouldNotify = true` here). It must NOT be
 * set to `now()` by the upsert itself.
 */
export interface UpsertResult {
  id: string;
  isNew: boolean;
  /**
   * True when a Slack send should be attempted for this capture.
   * Computed from: pre-update `notified_at` IS NULL
   *   OR now - pre-update `notified_at` > INCIDENT_ALERT_COOLDOWN_MS.
   * Also false when incident.status is `muted`.
   */
  shouldNotify: boolean;
  /** Current status of the incident (used for mute-gating in dispatcher). */
  status: IncidentStatus;
  /** Post-upsert occurrence count — so the Slack alert reports the real frequency. */
  occurrences: number;
  /** Post-upsert delivery-attempt count. */
  deliveryAttempts: number;
}

/** Filter options for `IncidentRepository.list`. */
export interface IncidentListFilter {
  status?: IncidentStatus | undefined;
  severity?: IncidentSeverity | undefined;
}

/**
 * Repository interface for incidents.
 * Implementations live in api/pipeline src/repositories/** (REQ-026).
 * The shared alerting code depends ONLY on this interface — never on drizzle-orm.
 */
export interface IncidentRepository {
  /**
   * Insert a new incident row or update an existing row with the same fingerprint.
   *
   * On conflict: increment occurrences, update last_seen_at, keep existing
   * firstSeenAt. Compute `shouldNotify` from the PRE-UPDATE `notified_at`
   * (REQ-011). Do NOT advance `notified_at` here.
   *
   * Returns the row id, whether this was a new insert, whether Slack should
   * fire, and the current status.
   */
  upsertByFingerprint(
    input: CaptureIncidentInput,
    cooldownMs: number,
  ): Promise<UpsertResult>;

  /**
   * Mark a delivered incident: set `notified_at = deliveredAt`, leave
   * `delivery_attempts` unchanged. Only mutates if `notified_at IS NULL`
   * (guarded update — EDGE-006).
   */
  markDelivered(id: string, deliveredAt: Date): Promise<void>;

  /**
   * Increment `delivery_attempts` on a failed send attempt (REQ-014).
   * Does NOT set `notified_at`.
   */
  incrementDeliveryAttempts(id: string): Promise<void>;

  /**
   * List undelivered incidents eligible for the delivery sweep (REQ-015/016).
   *
   * Selects: severity IN (warning, error, critical) AND notified_at IS NULL
   *          AND status = 'open' AND delivery_attempts < ALERT_MAX_DELIVERY_ATTEMPTS
   * Order: first_seen_at ASC (oldest first)
   * Limit: ALERT_SWEEP_BATCH_SIZE
   */
  listUndelivered(): Promise<Incident[]>;

  /**
   * List incidents for the admin UI (REQ-020).
   *
   * Optionally filter by status and/or severity.
   * Order: last_seen_at DESC (newest first).
   */
  list(filter?: IncidentListFilter): Promise<Incident[]>;

  /**
   * Update an incident's status (REQ-021).
   *
   * Returns the updated incident, or null if not found.
   */
  setStatus(id: string, status: IncidentStatus): Promise<Incident | null>;
}

/**
 * A delivery channel (e.g. Slack webhook) used by the alert dispatcher.
 */
export interface AlertChannel {
  /** True when the channel is configured and should be attempted. */
  readonly enabled: boolean;
  /** Attempt delivery. Returns true if the send succeeded. */
  send(incident: Incident): Promise<boolean>;
}
