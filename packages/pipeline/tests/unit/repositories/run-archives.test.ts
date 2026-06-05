import { describe, it, expect, vi } from "vitest";
import { canonicalizeUrl } from "@pipeline/processors/dedup.js";

describe("run-archives repository", () => {
  describe("social-marker methods", () => {
    function makeUpdateOnlyDb(): {
      db: { update: ReturnType<typeof vi.fn> };
      setSpy: ReturnType<typeof vi.fn>;
      whereSpy: ReturnType<typeof vi.fn>;
    } {
      const whereSpy = vi.fn().mockResolvedValue(undefined);
      const setSpy = vi.fn(() => ({ where: whereSpy }));
      const updateSpy = vi.fn(() => ({ set: setSpy }));
      return { db: { update: updateSpy }, setSpy, whereSpy };
    }

    it("markLinkedInPosted writes timestamp + merges permalink into social_metadata", async () => {
      const { db, setSpy } = makeUpdateOnlyDb();
      const { createRunArchivesRepo } = await import(
        "@pipeline/repositories/run-archives.js"
      );
      const repo = createRunArchivesRepo(db as never);
      const at = new Date("2026-05-11T12:00:00Z");
      await repo.markLinkedInPosted("run-x", at, "urn:li:share:123");
      const patch = setSpy.mock.calls[0]?.[0];
      expect(patch.linkedinPostedAt).toBe(at);
      expect(patch.socialMetadata).toBeDefined();
    });

    it("markLinkedInPosted skips JSON merge when permalink is null", async () => {
      const { db, setSpy } = makeUpdateOnlyDb();
      const { createRunArchivesRepo } = await import(
        "@pipeline/repositories/run-archives.js"
      );
      const repo = createRunArchivesRepo(db as never);
      const at = new Date("2026-05-11T12:00:00Z");
      await repo.markLinkedInPosted("run-x", at, null);
      const patch = setSpy.mock.calls[0]?.[0];
      expect(patch.linkedinPostedAt).toBe(at);
      expect(patch.socialMetadata).toBeUndefined();
    });

    it("markTwitterPosted writes timestamp + merges permalink", async () => {
      const { db, setSpy } = makeUpdateOnlyDb();
      const { createRunArchivesRepo } = await import(
        "@pipeline/repositories/run-archives.js"
      );
      const repo = createRunArchivesRepo(db as never);
      const at = new Date("2026-05-11T12:00:00Z");
      await repo.markTwitterPosted("run-x", at, "https://x.com/i/web/status/1");
      const patch = setSpy.mock.calls[0]?.[0];
      expect(patch.twitterPostedAt).toBe(at);
      expect(patch.socialMetadata).toBeDefined();
    });

    it("recordSocialFailure writes only error into social_metadata, no posted_at", async () => {
      const { db, setSpy } = makeUpdateOnlyDb();
      const { createRunArchivesRepo } = await import(
        "@pipeline/repositories/run-archives.js"
      );
      const repo = createRunArchivesRepo(db as never);
      await repo.recordSocialFailure("run-x", "linkedin", "401 Unauthorized");
      const patch = setSpy.mock.calls[0]?.[0];
      expect(patch.linkedinPostedAt).toBeUndefined();
      expect(patch.twitterPostedAt).toBeUndefined();
      expect(patch.socialMetadata).toBeDefined();
    });
  });

  // REQ-003/REQ-005: getPublishedCanonicalUrls returns only reviewed, !isDryRun, status=completed
  describe("getPublishedCanonicalUrls", () => {
    it("calls db.select to fetch qualifying archives and resolves URLs", async () => {
      // Use a mock db that tracks what was queried
      const selectCalls: unknown[] = [];
      let callCount = 0;

      const db = {
        select: vi.fn((cols?: unknown) => {
          selectCalls.push(cols);
          return {
            from: vi.fn(() => ({
              where: vi.fn(() => {
                callCount++;
                if (callCount === 1) {
                  // archives query: return empty so no URLs needed
                  return Promise.resolve([]);
                }
                return Promise.resolve([]);
              }),
            })),
          };
        }),
        insert: vi.fn(),
        update: vi.fn(),
      };

      const { createRunArchivesRepo } = await import(
        "@pipeline/repositories/run-archives.js"
      );
      const repo = createRunArchivesRepo(db as never);
      const result = await repo.getPublishedCanonicalUrls();

      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(0);
      // db.select should have been called at least once (for archives)
      expect(db.select).toHaveBeenCalled();
    });

    it("returns canonicalized URLs from qualifying archives (REQ-003)", async () => {
      // We need a db that returns archive rows with rawItemIds, then raw_item URLs
      const archiveRows = [
        {
          rankedItems: [
            { rawItemId: 1, score: 0.9, rationale: "top" },
            { rawItemId: 2, score: 0.7, rationale: "good" },
          ],
        },
      ];
      const rawItemRows = [
        { url: "https://Example.com/post?utm_source=rss" },
        { url: "https://example.com/another" },
      ];

      let callCount = 0;
      const db = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => {
              callCount++;
              if (callCount === 1) return Promise.resolve(archiveRows);
              return Promise.resolve(rawItemRows);
            }),
          })),
        })),
        insert: vi.fn(),
        update: vi.fn(),
      };

      const { createRunArchivesRepo } = await import(
        "@pipeline/repositories/run-archives.js"
      );
      const repo = createRunArchivesRepo(db as never);
      const result = await repo.getPublishedCanonicalUrls();

      expect(result).toBeInstanceOf(Set);
      // URL should be canonicalized (lowercase, tracking stripped)
      expect(result.has(canonicalizeUrl("https://Example.com/post?utm_source=rss"))).toBe(true);
      expect(result.has(canonicalizeUrl("https://example.com/another"))).toBe(true);
    });

    it("returns empty set when there are no qualifying archives (EDGE-005)", async () => {
      const db = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => Promise.resolve([])),
          })),
        })),
        insert: vi.fn(),
        update: vi.fn(),
      };

      const { createRunArchivesRepo } = await import(
        "@pipeline/repositories/run-archives.js"
      );
      const repo = createRunArchivesRepo(db as never);
      const result = await repo.getPublishedCanonicalUrls();

      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(0);
    });
  });
});
