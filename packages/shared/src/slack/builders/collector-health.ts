import type { HealthCheckCollector, CollectorHealthTrigger } from "../../types/collector-health.js";
import { headerBlock, sectionMarkdown, truncate } from "./_helpers.js";

export interface CollectorHealthFailure {
  collector: HealthCheckCollector;
  reason: string;
}

export function buildCollectorHealthMessage(args: {
  failures: CollectorHealthFailure[];
  trigger: CollectorHealthTrigger;
}): { blocks: unknown[] } {
  const blocks: unknown[] = [];

  blocks.push(headerBlock(`🔴 Collector health check failed (${args.trigger})`));

  const lines = args.failures.map(
    (f) => `• ${f.collector}: ${truncate(f.reason)}`,
  );
  blocks.push(sectionMarkdown(lines.join("\n")));

  return { blocks };
}
