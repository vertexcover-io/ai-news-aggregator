/**
 * Shared error-tracking taxonomy. Two orthogonal dimensions:
 *  - {@link ErrorCategory}: what kind of failure (promoted from the
 *    collector-health classifier, plus `code-bug` for exceptions in our stack).
 *  - {@link Fixability}: who/what resolves it — routes the incident to a lane.
 *
 * Pure types only — safe to import anywhere (no node/db deps).
 */

export type ErrorCategory =
  | "auth"
  | "rate-limit"
  | "network-timeout"
  | "blocked"
  | "schema"
  | "code-bug"
  | "unknown";

/** Resolution lane. `agent` → auto-fixable; `human` → needs a person; `notify` → transient. */
export type Fixability = "agent" | "human" | "notify";

/** Which package the error originated in. */
export type SourcePackage = "api" | "pipeline" | "web";

/** Lifecycle of a tracked incident. */
export type IncidentStatus = "open" | "pr_opened" | "resolved" | "suppressed";

/** Redacted, bounded context persisted with an incident and surfaced to Slack/GitHub. */
export interface IncidentContext {
  /** Redacted error message. */
  message: string;
  /** Redacted, truncated stack trace. */
  stack?: string;
  /** Logical source label (e.g. queue name, collector, route). */
  source?: string;
  runId?: string;
  jobId?: string;
}

/** The subset of a persisted incident the IncidentService reasons about. */
export interface ErrorIncidentRecord {
  fingerprint: string;
  category: ErrorCategory;
  fixability: Fixability;
  sourcePackage: SourcePackage;
  status: IncidentStatus;
  occurrenceCount: number;
  githubRef: string | null;
}

/** Result of classifying + fingerprinting a raw error. */
export interface ErrorAnalysis {
  category: ErrorCategory;
  fixability: Fixability;
  fingerprint: string;
  /** The logical source label used in the fingerprint. */
  source: string;
}
