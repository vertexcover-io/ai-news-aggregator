import { describe, it, expect, vi } from "vitest";
import type { Fixture } from "@newsletter/shared/types/eval-ranking";
import type { RawItemInsert } from "@newsletter/shared/db";
import type { EnrichedLinkContent } from "@newsletter/shared";
import { createManualFixture } from "@pipeline/eval/manual-fixture.js";
import type { EnrichmentContext } from "@pipeline/services/link-enrichment/types.js";

describe("createManualFixture", () => {
  it("dedups exact URL duplicates at input", async () => {
    const writeFixture = vi.fn((_f: Fixture) => Promise.resolve("/tmp/x.json"));
    const enrichRawItems = vi.fn(
      (items: RawItemInsert[], _ctx: EnrichmentContext) => Promise.resolve(items),
    );
    const result = await createManualFixture(
      ["https://a.com/1", "https://a.com/1", "https://a.com/2"],
      {},
      { writeFixture, enrichRawItems, now: () => new Date(1700000000000) },
    );
    expect(result.fixture.pool).toHaveLength(2);
    expect(enrichRawItems).toHaveBeenCalledOnce();
    expect(writeFixture).toHaveBeenCalledOnce();
  });

  it("uses negative synthetic IDs to avoid colliding with real raw_items", async () => {
    const writeFixture = vi.fn((_f: Fixture) => Promise.resolve("/tmp/x.json"));
    const enrichRawItems = vi.fn((items: RawItemInsert[]) => Promise.resolve(items));
    const result = await createManualFixture(
      ["https://a.com/1", "https://a.com/2", "https://a.com/3"],
      {},
      { writeFixture, enrichRawItems },
    );
    for (const item of result.fixture.pool) {
      expect(item.rawItemId).toBeLessThan(0);
    }
    const ids = result.fixture.pool.map((p) => p.rawItemId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("tags enrichmentStatus=failed when enriched.status is failed", async () => {
    const writeFixture = vi.fn((_f: Fixture) => Promise.resolve("/tmp/x.json"));
    const enrichRawItems = vi.fn((items: RawItemInsert[]) => {
      for (const item of items) {
        const enriched: EnrichedLinkContent = {
          url: item.url,
          fetchedAt: "2026-05-22T00:00:00.000Z",
          status: "failed",
          failureReason: "timeout",
        };
        item.metadata = {
          ...(item.metadata ?? { comments: [] }),
          enrichedLink: enriched,
        };
      }
      return Promise.resolve(items);
    });
    const result = await createManualFixture(
      ["https://a.com/1"],
      {},
      { writeFixture, enrichRawItems },
    );
    expect(result.fixture.pool[0].enrichmentStatus).toBe("failed");
  });

  it("throws on empty url list", async () => {
    await expect(
      createManualFixture(
        [],
        {},
        {
          writeFixture: vi.fn(() => Promise.resolve("")),
          enrichRawItems: vi.fn((items: RawItemInsert[]) => Promise.resolve(items)),
        },
      ),
    ).rejects.toThrow(/no urls/i);
  });
});
