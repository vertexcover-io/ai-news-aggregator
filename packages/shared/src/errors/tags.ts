/**
 * One-stop error analysis + PostHog tag builder. Capture sites call
 * {@link buildExceptionTags} to enrich every `captureException` with the
 * classification, source package, and a deterministic `$exception_fingerprint`
 * (PostHog's grouping-override property) so PostHog groups exactly as our
 * `error_incidents` table does.
 */
import { classifyError } from "./classify.js";
import { computeFingerprint } from "./fingerprint.js";
import type { ErrorAnalysis, SourcePackage } from "./types.js";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function stackOf(err: unknown): string | undefined {
  return err instanceof Error ? err.stack : undefined;
}

/** Classify + fingerprint a raw error against a logical source label. */
export function analyzeError(err: unknown, opts: { source: string }): ErrorAnalysis {
  const { category, fixability } = classifyError(err);
  const fingerprint = computeFingerprint({
    category,
    source: opts.source,
    message: messageOf(err),
    stack: stackOf(err),
  });
  return { category, fixability, fingerprint, source: opts.source };
}

export interface ExceptionTagOpts {
  sourcePackage: SourcePackage;
  /** Logical source label (queue, collector, route, crash label). */
  source: string;
  runId?: string;
  jobId?: string;
}

/**
 * Build the PostHog property bag for a `captureException` call. The existing
 * `captureException(err, context)` signature already forwards these as
 * properties, so call sites stay a one-liner.
 */
export function buildExceptionTags(
  err: unknown,
  opts: ExceptionTagOpts,
): Record<string, unknown> {
  const analysis = analyzeError(err, { source: opts.source });
  return {
    category: analysis.category,
    fixability: analysis.fixability,
    source_package: opts.sourcePackage,
    error_source: opts.source,
    $exception_fingerprint: analysis.fingerprint,
    ...(opts.runId !== undefined ? { run_id: opts.runId } : {}),
    ...(opts.jobId !== undefined ? { job_id: opts.jobId } : {}),
  };
}
