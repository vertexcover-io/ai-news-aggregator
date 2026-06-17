import { describe, it, expect, vi } from "vitest";
import {
  createRedisLlmTxtCache,
  llmTxtVersionKey,
} from "@api/services/llm-txt-cache.js";

describe("llmTxtVersionKey", () => {
  const base = {
    variant: "index" as const,
    baseUrl: "https://news.example.com",
    issueSignatures: ["r1:100:0", "r2:200:0"],
    canonSignatures: ["c1:2026-01-01"],
  };

  it("is stable for identical inputs", () => {
    expect(llmTxtVersionKey(base)).toBe(llmTxtVersionKey({ ...base }));
  });

  it("changes when an issue signature changes (a published issue was edited)", () => {
    const edited = { ...base, issueSignatures: ["r1:100:500", "r2:200:0"] };
    expect(llmTxtVersionKey(edited)).not.toBe(llmTxtVersionKey(base));
  });

  it("changes when a new issue is added", () => {
    const added = { ...base, issueSignatures: [...base.issueSignatures, "r3:300:0"] };
    expect(llmTxtVersionKey(added)).not.toBe(llmTxtVersionKey(base));
  });

  it("changes when canon changes", () => {
    const canon = { ...base, canonSignatures: ["c1:2026-01-02"] };
    expect(llmTxtVersionKey(canon)).not.toBe(llmTxtVersionKey(base));
  });

  it("differs by variant and by scope", () => {
    expect(llmTxtVersionKey({ ...base, variant: "full" })).not.toBe(
      llmTxtVersionKey(base),
    );
    expect(
      llmTxtVersionKey({ ...base, variant: "issue", scope: "run-1" }),
    ).not.toBe(llmTxtVersionKey({ ...base, variant: "issue", scope: "run-2" }));
  });
});

describe("createRedisLlmTxtCache", () => {
  it("namespaces keys and sets a TTL on write", async () => {
    const redis = {
      get: vi.fn(() => Promise.resolve(null)),
      set: vi.fn(() => Promise.resolve("OK")),
    };
    const cache = createRedisLlmTxtCache(redis);

    await cache.get("k1");
    expect(redis.get).toHaveBeenCalledWith("llm-txt:k1");

    await cache.set("k1", "value");
    expect(redis.set).toHaveBeenCalledWith("llm-txt:k1", "value", "EX", 86_400);
  });

  it("returns a cached hit", async () => {
    const redis = {
      get: vi.fn(() => Promise.resolve("cached-body")),
      set: vi.fn(() => Promise.resolve("OK")),
    };
    const cache = createRedisLlmTxtCache(redis);
    expect(await cache.get("k1")).toBe("cached-body");
  });
});
