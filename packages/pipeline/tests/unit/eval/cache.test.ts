import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EvalCache, type CachedResponse } from "@pipeline/eval/cache.js";

const sample: CachedResponse = {
  rankedItems: [
    { rawItemId: 1, score: 0.9, rationale: "Developer-relevance signal" },
    { rawItemId: 2, score: 0.8, rationale: "Signal-vs-hype matters" },
  ],
  usage: {
    inputTokens: 100,
    outputTokens: 50,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  },
  model: "claude-haiku-4-5",
  savedAt: "2026-05-22T00:00:00.000Z",
  promptHash: "abcd1234abcd1234",
};

describe("EvalCache", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "eval-cache-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("round-trips set/get", async () => {
    const cache = new EvalCache(dir);
    await cache.set("fix-1", "prompt-A", "model-X", sample);
    const result = await cache.get("fix-1", "prompt-A", "model-X");
    expect(result).toEqual(sample);
  });

  it("key is deterministic for the same inputs", () => {
    const cache = new EvalCache(dir);
    const a = cache.key("fix-1", "prompt-A", "model-X");
    const b = cache.key("fix-1", "prompt-A", "model-X");
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
  });

  it("key differs when prompt differs", () => {
    const cache = new EvalCache(dir);
    const a = cache.key("fix-1", "prompt-A", "model-X");
    const b = cache.key("fix-1", "prompt-B", "model-X");
    expect(a).not.toBe(b);
  });

  it("key differs when fixtureId or model differ", () => {
    const cache = new EvalCache(dir);
    expect(cache.key("fix-1", "p", "m")).not.toBe(
      cache.key("fix-2", "p", "m"),
    );
    expect(cache.key("fix-1", "p", "m")).not.toBe(
      cache.key("fix-1", "p", "m2"),
    );
  });

  it("returns null on cache miss", async () => {
    const cache = new EvalCache(dir);
    expect(await cache.get("absent", "p", "m")).toBeNull();
  });

  it("bypassCache flag forces get to null and skips set", async () => {
    const writer = new EvalCache(dir);
    await writer.set("fix-1", "prompt-A", "model-X", sample);

    const reader = new EvalCache(dir, { bypassCache: true });
    expect(await reader.get("fix-1", "prompt-A", "model-X")).toBeNull();

    await reader.set("fix-1", "prompt-B", "model-X", sample);
    const checker = new EvalCache(dir);
    expect(await checker.get("fix-1", "prompt-B", "model-X")).toBeNull();
  });

  it("returns null on malformed JSON file (no throw)", async () => {
    const cache = new EvalCache(dir);
    const key = cache.key("fix-1", "prompt-A", "model-X");
    await writeFile(join(dir, `${key}.json`), "{not valid json", "utf8");
    expect(await cache.get("fix-1", "prompt-A", "model-X")).toBeNull();
  });
});
