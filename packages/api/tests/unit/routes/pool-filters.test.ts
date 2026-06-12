/**
 * Tests for Step 2: pool filters (selectedSources + shortlistedOnly)
 * Tests for Step 3: facets endpoint
 * Tests for Step 4: shortlistedItemIds admin-only exposure
 *
 * REQ-007, REQ-008, REQ-010, REQ-011, REQ-015, REQ-017, EDGE-002, EDGE-012
 */
import { describe, it, expect, vi } from "vitest";
import { setTestTenant } from "../../helpers/tenant.js";
import { Hono } from "hono";
import type { PoolResponse, PoolItem } from "@newsletter/shared";
import {
  createAdminArchivesRouter,
  createPublicArchivesRouter,
} from "@api/routes/archives.js";
import type { RunArchivesRepo, RunArchiveRow } from "@api/repositories/run-archives.js";
import type { RawItemsRepo } from "@api/repositories/raw-items.js";
import type { SourceFacet } from "@api/repositories/run-archives.js";

// ---- helpers ----

function makeRow(overrides: Partial<RunArchiveRow> = {}): RunArchiveRow {
  const completedAt = new Date("2026-05-01T10:00:00Z");
  return {
    id: "run-1",
    status: "completed",
    rankedItems: [],
    topN: 5,
    reviewed: true,
    completedAt,
    publishedAt: null,
    createdAt: completedAt,
    startedAt: new Date("2026-05-01T09:00:00Z"),
    sourceTypes: ["blog", "reddit"],
    digestHeadline: null,
    digestSummary: null,
    hook: null,
    sourceTelemetry: null,
    slackNotifiedAt: null,
    emailSentAt: null,
    linkedinPostedAt: null,
    twitterPostedAt: null,
    notificationState: null,
    isDryRun: false,
    costBreakdown: null,
    runFunnel: null,
    socialMetadata: null,
    shortlistedItemIds: [1, 2, 3],
    ...overrides,
  };
}

function makePoolItem(overrides: Partial<PoolItem> = {}): PoolItem {
  return {
    id: 1,
    title: "Test item",
    url: "https://openai.com/post",
    sourceType: "blog",
    author: null,
    publishedAt: null,
    engagement: { points: 10, commentCount: 0 },
    imageUrl: null,
    sourceIdentifier: "openai.com",
    preview: { kind: "none" },
    recapSummary: null,
    ...overrides,
  };
}

function makeArchiveRepo(
  row: RunArchiveRow | null,
  poolResult?: PoolResponse,
  facets?: SourceFacet[],
): RunArchivesRepo {
  return {
    findById: vi.fn(() => Promise.resolve(row)),
    list: vi.fn(() => Promise.resolve([])),
    listReviewed: vi.fn(() => Promise.resolve([])),
    updateRankedItems: vi.fn(() => Promise.resolve(row as RunArchiveRow)),
    findPoolItems: vi.fn(() =>
      Promise.resolve(poolResult ?? { items: [], total: 0 }),
    ),
    getSourceFacets: vi.fn(() =>
      Promise.resolve(facets ?? []),
    ),
    markSlackNotified: vi.fn(() => Promise.resolve()),
    searchReviewed: vi.fn(() => Promise.resolve({ archives: [], total: 0 })),
    findMostRecentReviewed: vi.fn(() => Promise.resolve(null)),
    findLatestReviewedSince: vi.fn(() => Promise.resolve(null)),
    markEmailSent: vi.fn(() => Promise.resolve()),
    markNotification: vi.fn(() => Promise.resolve()),
    markLinkedInPosted: vi.fn(() => Promise.resolve()),
    markTwitterPosted: vi.fn(() => Promise.resolve()),
    recordSocialFailure: vi.fn(() => Promise.resolve()),
    delete: vi.fn(() => Promise.resolve({ deleted: true, removedEmailSends: 0 })),
    getReviewedDigestCountsByDerivedSource: vi.fn(() => Promise.resolve(new Map())),
    getRecentSourceTelemetry: vi.fn(() => Promise.resolve(new Map())),
    getSourceFailuresInRange: vi.fn(() => Promise.resolve([])),
    countCompletedRunsInRange: vi.fn(() => Promise.resolve(0)),
  };
}

function makeRawItemsRepo(): RawItemsRepo {
  return {
    findByIds: vi.fn(() => Promise.resolve([])),
  };
}

function makeAdminApp(archiveRepo: RunArchivesRepo): Hono {
  const app = new Hono();
  app.use("*", setTestTenant());
  const router = createAdminArchivesRouter({
    getRawItemsRepo: () => makeRawItemsRepo(),
    getArchiveRepo: () => archiveRepo,
  });
  app.route("/api/admin/archives", router);
  return app;
}

function makePublicApp(archiveRepo: RunArchivesRepo): Hono {
  const app = new Hono();
  app.use("*", setTestTenant());
  const router = createPublicArchivesRouter({
    getRawItemsRepo: () => makeRawItemsRepo(),
    getArchiveRepo: () => archiveRepo,
  });
  app.route("/api/archives", router);
  return app;
}

// ---- Step 2: pool filters ----

describe("GET /api/admin/archives/:runId/pool — source + shortlist filters (REQ-015, REQ-017)", () => {
  it("REQ-007/008: pool response items include sourceIdentifier and preview", async () => {
    const poolItem = makePoolItem();
    const archiveRepo = makeArchiveRepo(makeRow(), { items: [poolItem], total: 1 });
    const app = makeAdminApp(archiveRepo);
    const res = await app.request("/api/admin/archives/run-1/pool");
    expect(res.status).toBe(200);
    const body = (await res.json()) as PoolResponse;
    expect(body.items[0].sourceIdentifier).toBe("openai.com");
    expect(body.items[0].preview).toEqual({ kind: "none" });
  });

  it("REQ-015: passes selectedSources filter from ?sources= param", async () => {
    const archiveRepo = makeArchiveRepo(makeRow(), { items: [], total: 0 });
    const app = makeAdminApp(archiveRepo);
    await app.request("/api/admin/archives/run-1/pool?sources=openai.com&sources=r%2FLocalLLaMA");
    const findPoolItems = archiveRepo.findPoolItems as ReturnType<typeof vi.fn>;
    const [, opts] = findPoolItems.mock.calls[0] as [string, { selectedSources?: string[] }];
    expect(opts.selectedSources).toEqual(["openai.com", "r/LocalLLaMA"]);
  });

  it("REQ-017: passes shortlistedOnly=true when ?shortlisted=true", async () => {
    const archiveRepo = makeArchiveRepo(makeRow(), { items: [], total: 0 });
    const app = makeAdminApp(archiveRepo);
    await app.request("/api/admin/archives/run-1/pool?shortlisted=true");
    const findPoolItems = archiveRepo.findPoolItems as ReturnType<typeof vi.fn>;
    const [, opts] = findPoolItems.mock.calls[0] as [
      string,
      { shortlistedOnly?: boolean; shortlistedIds?: number[] | null },
    ];
    expect(opts.shortlistedOnly).toBe(true);
    expect(opts.shortlistedIds).toEqual([1, 2, 3]);
  });

  it("REQ-017: AND composition — both sources and shortlisted filters passed together", async () => {
    const archiveRepo = makeArchiveRepo(makeRow(), { items: [], total: 0 });
    const app = makeAdminApp(archiveRepo);
    await app.request("/api/admin/archives/run-1/pool?sources=openai.com&shortlisted=true");
    const findPoolItems = archiveRepo.findPoolItems as ReturnType<typeof vi.fn>;
    const [, opts] = findPoolItems.mock.calls[0] as [
      string,
      { selectedSources?: string[]; shortlistedOnly?: boolean; shortlistedIds?: number[] | null },
    ];
    expect(opts.selectedSources).toEqual(["openai.com"]);
    expect(opts.shortlistedOnly).toBe(true);
    expect(opts.shortlistedIds).toEqual([1, 2, 3]);
  });

});

// ---- Step 3: facets endpoint ----

describe("GET /api/admin/archives/:runId/source-facets (REQ-016)", () => {
  it("returns facets array from repo", async () => {
    const facets: SourceFacet[] = [
      { sourceType: "blog", identifier: "openai.com", displayName: "OpenAI", count: 5 },
      { sourceType: "reddit", identifier: "r/LocalLLaMA", displayName: "r/LocalLLaMA", count: 3 },
    ];
    const archiveRepo = makeArchiveRepo(makeRow(), undefined, facets);
    const app = makeAdminApp(archiveRepo);
    const res = await app.request("/api/admin/archives/run-1/source-facets");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { facets: SourceFacet[] };
    expect(body.facets).toHaveLength(2);
    expect(body.facets[0]).toEqual({
      sourceType: "blog",
      identifier: "openai.com",
      displayName: "OpenAI",
      count: 5,
    });
    expect(body.facets[1]).toEqual({
      sourceType: "reddit",
      identifier: "r/LocalLLaMA",
      displayName: "r/LocalLLaMA",
      count: 3,
    });
  });

  // EDGE-002 (distinct facets by sourceType+identifier) and EDGE-012 (no
  // truncation) were removed: the route does not compute or transform facets —
  // it returns the repo's array verbatim, so these only re-asserted the mock's
  // own input. Facet derivation is repo-level behavior covered elsewhere.

  it("returns 404 when archive not found", async () => {
    const archiveRepo = makeArchiveRepo(null);
    const app = makeAdminApp(archiveRepo);
    const res = await app.request("/api/admin/archives/nonexistent/source-facets");
    expect(res.status).toBe(404);
  });
});

// ---- Step 4: shortlistedItemIds admin-only ----

describe("Admin GET includes shortlistedItemIds (REQ-010, REQ-011)", () => {
  it("REQ-010: admin GET includes shortlistedItemIds array", async () => {
    const archiveRepo = makeArchiveRepo(makeRow({ shortlistedItemIds: [1, 2, 3] }));
    const app = makeAdminApp(archiveRepo);
    const res = await app.request("/api/admin/archives/run-1");
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.shortlistedItemIds).toEqual([1, 2, 3]);
  });

  it("REQ-010: admin GET includes shortlistedItemIds=null for legacy runs", async () => {
    const archiveRepo = makeArchiveRepo(makeRow({ shortlistedItemIds: null }));
    const app = makeAdminApp(archiveRepo);
    const res = await app.request("/api/admin/archives/run-1");
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.shortlistedItemIds).toBeNull();
  });

  it("REQ-011: public GET does NOT include shortlistedItemIds", async () => {
    const archiveRepo = makeArchiveRepo(makeRow({ shortlistedItemIds: [1, 2, 3], reviewed: true }));
    const app = makePublicApp(archiveRepo);
    const res = await app.request("/api/archives/run-1");
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.shortlistedItemIds).toBeUndefined();
  });
});
