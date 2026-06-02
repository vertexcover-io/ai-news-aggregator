import type { HealthCheckResult, HealthCheckReport, CollectorType } from "@newsletter/shared/types";

const ALL_COLLECTORS: CollectorType[] = ["hn", "reddit", "twitter", "web_search", "blog"];

export interface HealthCheckFns {
  hn: () => Promise<HealthCheckResult>;
  reddit: () => Promise<HealthCheckResult>;
  twitter: () => Promise<HealthCheckResult>;
  webSearch: () => Promise<HealthCheckResult>;
  blog: () => Promise<HealthCheckResult>;
}

export interface RunHealthChecksOptions {
  /** When set, only runs the specified collector type. */
  collectorType?: CollectorType;
}

export async function runAllHealthChecks(
  healthFns: HealthCheckFns,
  options: RunHealthChecksOptions = {},
): Promise<HealthCheckReport> {
  const start = Date.now();

  const types = options.collectorType
    ? [options.collectorType]
    : ALL_COLLECTORS;

  const fnMap: Record<CollectorType, () => Promise<HealthCheckResult>> = {
    hn: healthFns.hn,
    reddit: healthFns.reddit,
    twitter: healthFns.twitter,
    web_search: healthFns.webSearch,
    blog: healthFns.blog,
  };
  const fns = types.map((type) => fnMap[type]());

  const settled = await Promise.allSettled(fns);
  const results: HealthCheckResult[] = types.map((type, i) => {
    const r = settled[i];
    if (r.status === "fulfilled") return r.value;
    return {
      collector: type,
      status: "failed",
      durationMs: 0,
      error: "Unexpected health check error",
    };
  });

  let failedCount = 0;
  let healthyCount = 0;
  let skippedCount = 0;

  for (const result of results) {
    if (result.status === "healthy") healthyCount++;
    else if (result.status === "failed") failedCount++;
    else skippedCount++;
  }

  return {
    results,
    totalDurationMs: Date.now() - start,
    failedCount,
    healthyCount,
    skippedCount,
  };
}
