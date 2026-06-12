import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PIPELINE_START_JITTER_MS,
  computeJitterMs,
  parsePipelineStartJitterMs,
} from "@shared/scheduling/jitter.js";

describe("computeJitterMs (REQ-066)", () => {
  it("maps the injected rand across [0, maxMs)", () => {
    expect(computeJitterMs(() => 0, 180_000)).toBe(0);
    expect(computeJitterMs(() => 0.5, 180_000)).toBe(90_000);
    expect(computeJitterMs(() => 0.999_999, 180_000)).toBeLessThan(180_000);
  });

  it("is deterministic for a fixed rand", () => {
    const rand = () => 0.25;
    expect(computeJitterMs(rand, 60_000)).toBe(computeJitterMs(rand, 60_000));
  });

  it("returns 0 when the window is 0 (jitter disabled) without consuming rand", () => {
    const rand = vi.fn(() => 0.7);
    expect(computeJitterMs(rand, 0)).toBe(0);
    expect(rand).not.toHaveBeenCalled();
  });

  it("returns whole milliseconds", () => {
    expect(Number.isInteger(computeJitterMs(() => 0.123_456_789, 180_000))).toBe(true);
  });
});

describe("parsePipelineStartJitterMs", () => {
  it("defaults to 3 minutes when unset", () => {
    expect(parsePipelineStartJitterMs(undefined)).toBe(DEFAULT_PIPELINE_START_JITTER_MS);
    expect(parsePipelineStartJitterMs("")).toBe(DEFAULT_PIPELINE_START_JITTER_MS);
  });

  it("parses explicit values; '0' disables", () => {
    expect(parsePipelineStartJitterMs("0")).toBe(0);
    expect(parsePipelineStartJitterMs("60000")).toBe(60_000);
  });

  it("falls back to the default on junk or negative values", () => {
    expect(parsePipelineStartJitterMs("abc")).toBe(DEFAULT_PIPELINE_START_JITTER_MS);
    expect(parsePipelineStartJitterMs("-5")).toBe(DEFAULT_PIPELINE_START_JITTER_MS);
  });
});
