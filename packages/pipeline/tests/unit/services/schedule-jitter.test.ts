import { describe, it, expect } from "vitest";

// RED phase: test the jitter function before it exists
// The function will be imported from @pipeline/services/schedule-jitter.js

describe("Phase 10: Schedule jitter (RED)", () => {
  const JITTER_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

  it("REQ-066: same tenant + same time → deterministic jitter", async () => {
    const { computeJitterMs } = await import(
      "@pipeline/services/schedule-jitter.js"
    );
    const tenantId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const nominalTime = 1700000000000;

    const j1 = computeJitterMs(tenantId, nominalTime, JITTER_WINDOW_MS);
    const j2 = computeJitterMs(tenantId, nominalTime, JITTER_WINDOW_MS);
    expect(j1).toBe(j2); // deterministic
  });

  it("REQ-066: different tenants → different jitter", async () => {
    const { computeJitterMs } = await import(
      "@pipeline/services/schedule-jitter.js"
    );
    const tenantA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const tenantB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const nominalTime = 1700000000000;

    const jA = computeJitterMs(tenantA, nominalTime, JITTER_WINDOW_MS);
    const jB = computeJitterMs(tenantB, nominalTime, JITTER_WINDOW_MS);

    // Different tenants should get different jitter (with very high probability)
    // Verify they're within the expected window
    expect(Math.abs(jA)).toBeLessThanOrEqual(JITTER_WINDOW_MS);
    expect(Math.abs(jB)).toBeLessThanOrEqual(JITTER_WINDOW_MS);
    // They should differ given different tenant IDs
    expect(jA).not.toBe(jB);
  });

  it("REQ-066: jitter stays within ±window", async () => {
    const { computeJitterMs } = await import(
      "@pipeline/services/schedule-jitter.js"
    );

    for (let i = 0; i < 100; i++) {
      const tenantId = `tenant-${i}`;
      const j = computeJitterMs(tenantId, 1700000000000, JITTER_WINDOW_MS);
      expect(j).toBeGreaterThanOrEqual(-JITTER_WINDOW_MS);
      expect(j).toBeLessThanOrEqual(JITTER_WINDOW_MS);
    }
  });

  it("REQ-066: same tenant + different nominal time → different jitter", async () => {
    const { computeJitterMs } = await import(
      "@pipeline/services/schedule-jitter.js"
    );
    const tenantId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

    const j1 = computeJitterMs(tenantId, 1700000000000, JITTER_WINDOW_MS);
    const j2 = computeJitterMs(tenantId, 1700000000001, JITTER_WINDOW_MS);
    expect(j1).not.toBe(j2);
  });
});
