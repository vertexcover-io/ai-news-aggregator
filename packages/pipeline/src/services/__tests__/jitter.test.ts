import { describe, it, expect } from "vitest";
import { computeJitterOffsetMs, type JitterOptions } from "@pipeline/services/jitter.js";

describe("computeJitterOffsetMs", () => {
  const seed1 = "tenant-a";
  const seed2 = "tenant-b";

  it("returns a deterministic offset for the same seed and window", () => {
    const opts: JitterOptions = { windowMs: 120_000 };
    const a = computeJitterOffsetMs(seed1, opts);
    const b = computeJitterOffsetMs(seed1, opts);
    expect(a).toBe(b);
  });

  it("returns different offsets for different seeds", () => {
    const opts: JitterOptions = { windowMs: 120_000 };
    const a = computeJitterOffsetMs(seed1, opts);
    const b = computeJitterOffsetMs(seed2, opts);
    expect(a).not.toBe(b);
  });

  it("returns an offset within the window [0, windowMs]", () => {
    const opts: JitterOptions = { windowMs: 120_000 };
    for (let i = 0; i < 100; i++) {
      const offset = computeJitterOffsetMs(`tenant-${i}`, opts);
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThanOrEqual(opts.windowMs);
    }
  });

  it("uses symm mode to return an offset in [-windowMs, +windowMs]", () => {
    const opts: JitterOptions = { windowMs: 120_000, mode: "symmetric" };
    for (let i = 0; i < 100; i++) {
      const offset = computeJitterOffsetMs(`tenant-${i}`, opts);
      expect(offset).toBeGreaterThanOrEqual(-opts.windowMs);
      expect(offset).toBeLessThanOrEqual(opts.windowMs);
    }
  });

  it("returns 0 when windowMs is 0", () => {
    const opts: JitterOptions = { windowMs: 0 };
    expect(computeJitterOffsetMs(seed1, opts)).toBe(0);
  });

  it("spreads values reasonably across symmetric window", () => {
    // With many seeds, offsets should cover both positive and negative
    const opts: JitterOptions = { windowMs: 120_000, mode: "symmetric" };
    const offsets = Array.from({ length: 50 }, (_, i) =>
      computeJitterOffsetMs(`t-${i}`, opts),
    );
    const positive = offsets.filter((o) => o > 0);
    const negative = offsets.filter((o) => o < 0);
    expect(positive.length).toBeGreaterThan(0);
    expect(negative.length).toBeGreaterThan(0);
  });
});
