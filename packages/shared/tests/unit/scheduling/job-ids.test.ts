import { describe, expect, it } from "vitest";
import {
  LEGACY_COLLECTOR_HEALTH_SCHEDULER_KEY,
  LEGACY_PROCESSING_SCHEDULER_KEYS,
  jobIdFor,
  schedulerKeyFor,
  type SchedulerKind,
} from "@shared/scheduling/job-ids.js";

const TENANT_A = "0c0ffee0-aaaa-bbbb-cccc-123456789012";

describe("schedulerKeyFor", () => {
  it("builds '<kind>:<tenantId>' keys for every scheduler kind (REQ-062)", () => {
    const kinds: SchedulerKind[] = [
      "pipeline-run",
      "email-send",
      "linkedin-post",
      "twitter-post",
      "collector-health",
      "social-health",
    ];
    for (const kind of kinds) {
      expect(schedulerKeyFor(kind, TENANT_A)).toBe(`${kind}:${TENANT_A}`);
    }
  });

  it("yields distinct keys for distinct tenants of the same kind", () => {
    const other = "11111111-2222-4333-8444-555555555555";
    expect(schedulerKeyFor("pipeline-run", TENANT_A)).not.toBe(
      schedulerKeyFor("pipeline-run", other),
    );
  });

  it("never collides with the legacy ':default' keys for uuid tenants", () => {
    const legacy = new Set<string>([
      ...LEGACY_PROCESSING_SCHEDULER_KEYS,
      LEGACY_COLLECTOR_HEALTH_SCHEDULER_KEY,
    ]);
    expect(legacy.has(schedulerKeyFor("pipeline-run", TENANT_A))).toBe(false);
    expect(legacy.has(schedulerKeyFor("collector-health", TENANT_A))).toBe(false);
  });
});

describe("jobIdFor", () => {
  it("builds deterministic per-run job ids", () => {
    expect(jobIdFor("email-send", "abc-123")).toBe("email-send-abc-123");
    expect(jobIdFor("linkedin-post", "run-1")).toBe("linkedin-post-run-1");
  });
  it("never contains a colon (bullmq >=5.x rejects custom ids with ':')", () => {
    for (const channel of ["email-send", "linkedin-post", "twitter-post"] as const) {
      expect(jobIdFor(channel, "0c0ffee0-aaaa-bbbb-cccc-123456789012")).not.toContain(":");
    }
  });
});
