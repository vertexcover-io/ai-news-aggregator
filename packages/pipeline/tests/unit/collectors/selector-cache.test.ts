import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { WebSourceSelectors } from "@pipeline/types.js";

const TEST_DIR = join(tmpdir(), "selector-cache-test");

function testFilePath(): string {
  return join(TEST_DIR, `cache-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

const SELECTORS: WebSourceSelectors = {
  articleLink: "a.post-link",
  title: "h1.title",
  content: "div.content",
  author: "span.author",
  date: "time.published",
};

const SELECTORS_2: WebSourceSelectors = {
  articleLink: "a.entry",
  title: "h2",
  content: "article",
};

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("createSelectorCache", () => {
  // REQ-007: Read/write/create cache file
  describe("REQ-007: file operations", () => {
    it("creates a new cache when file does not exist", async () => {
      const { createSelectorCache } = await import("@pipeline/collectors/selector-cache.js");
      const filePath = testFilePath();

      const cache = createSelectorCache(filePath);
      cache.save();

      expect(existsSync(filePath)).toBe(true);
      const data = JSON.parse(readFileSync(filePath, "utf-8"));
      expect(data).toEqual({ entries: {} });
    });

    it("reads existing cache from file", async () => {
      const { createSelectorCache } = await import("@pipeline/collectors/selector-cache.js");
      const filePath = testFilePath();
      const existing = {
        entries: {
          "https://example.com": {
            selectors: SELECTORS,
            derivedAt: "2026-01-01T00:00:00.000Z",
            lastVerifiedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      };
      writeFileSync(filePath, JSON.stringify(existing), "utf-8");

      const cache = createSelectorCache(filePath);
      const result = cache.get("https://example.com");

      expect(result).toEqual(SELECTORS);
    });
  });

  // EDGE-002: Missing cache file creates new one
  describe("EDGE-002: missing file", () => {
    it("returns null for any URL when file did not exist", async () => {
      const { createSelectorCache } = await import("@pipeline/collectors/selector-cache.js");
      const filePath = testFilePath();

      const cache = createSelectorCache(filePath);

      expect(cache.get("https://nonexistent.com")).toBeNull();
    });
  });

  // EDGE-006: Same URL returns same cached entry
  describe("EDGE-006: get returns set entry", () => {
    it("returns selectors after set for the same URL", async () => {
      const { createSelectorCache } = await import("@pipeline/collectors/selector-cache.js");
      const filePath = testFilePath();

      const cache = createSelectorCache(filePath);
      cache.set("https://blog.example.com", SELECTORS);

      expect(cache.get("https://blog.example.com")).toEqual(SELECTORS);
    });

    it("returns different selectors for different URLs", async () => {
      const { createSelectorCache } = await import("@pipeline/collectors/selector-cache.js");
      const filePath = testFilePath();

      const cache = createSelectorCache(filePath);
      cache.set("https://a.com", SELECTORS);
      cache.set("https://b.com", SELECTORS_2);

      expect(cache.get("https://a.com")).toEqual(SELECTORS);
      expect(cache.get("https://b.com")).toEqual(SELECTORS_2);
    });

    it("persists entries across cache instances", async () => {
      const { createSelectorCache } = await import("@pipeline/collectors/selector-cache.js");
      const filePath = testFilePath();

      const cache1 = createSelectorCache(filePath);
      cache1.set("https://blog.example.com", SELECTORS);

      const cache2 = createSelectorCache(filePath);
      expect(cache2.get("https://blog.example.com")).toEqual(SELECTORS);
    });
  });

  // EDGE-007: Invalid JSON in cache file → empty cache
  describe("EDGE-007: invalid JSON", () => {
    it("starts with empty cache when file contains invalid JSON", async () => {
      const { createSelectorCache } = await import("@pipeline/collectors/selector-cache.js");
      const filePath = testFilePath();
      writeFileSync(filePath, "not valid json {{{", "utf-8");

      const cache = createSelectorCache(filePath);

      expect(cache.get("https://anything.com")).toBeNull();
    });

    it("can set and get after recovering from invalid JSON", async () => {
      const { createSelectorCache } = await import("@pipeline/collectors/selector-cache.js");
      const filePath = testFilePath();
      writeFileSync(filePath, "corrupted", "utf-8");

      const cache = createSelectorCache(filePath);
      cache.set("https://recovered.com", SELECTORS);

      expect(cache.get("https://recovered.com")).toEqual(SELECTORS);
    });
  });

  describe("invalidate", () => {
    it("removes an entry so get returns null", async () => {
      const { createSelectorCache } = await import("@pipeline/collectors/selector-cache.js");
      const filePath = testFilePath();

      const cache = createSelectorCache(filePath);
      cache.set("https://to-remove.com", SELECTORS);
      cache.invalidate("https://to-remove.com");

      expect(cache.get("https://to-remove.com")).toBeNull();
    });

    it("persists invalidation to disk", async () => {
      const { createSelectorCache } = await import("@pipeline/collectors/selector-cache.js");
      const filePath = testFilePath();

      const cache1 = createSelectorCache(filePath);
      cache1.set("https://to-remove.com", SELECTORS);

      const cache2 = createSelectorCache(filePath);
      cache2.invalidate("https://to-remove.com");

      const cache3 = createSelectorCache(filePath);
      expect(cache3.get("https://to-remove.com")).toBeNull();
    });

    it("does nothing when invalidating a non-existent URL", async () => {
      const { createSelectorCache } = await import("@pipeline/collectors/selector-cache.js");
      const filePath = testFilePath();

      const cache = createSelectorCache(filePath);
      cache.invalidate("https://never-set.com");

      expect(cache.get("https://never-set.com")).toBeNull();
    });
  });

  describe("set timestamps", () => {
    it("stores derivedAt and lastVerifiedAt as ISO timestamps", async () => {
      const { createSelectorCache } = await import("@pipeline/collectors/selector-cache.js");
      const filePath = testFilePath();
      const before = new Date().toISOString();

      const cache = createSelectorCache(filePath);
      cache.set("https://ts.com", SELECTORS);

      const after = new Date().toISOString();
      const raw = JSON.parse(readFileSync(filePath, "utf-8"));
      const entry = raw.entries["https://ts.com"];

      expect(entry.derivedAt).toBeDefined();
      expect(entry.lastVerifiedAt).toBeDefined();
      expect(entry.derivedAt >= before).toBe(true);
      expect(entry.derivedAt <= after).toBe(true);
      expect(entry.lastVerifiedAt).toBe(entry.derivedAt);
    });
  });
});
