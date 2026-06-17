import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type { HomePagePayload } from "@newsletter/shared";
import type { PublicTenantCtx } from "@api/middleware/resolve-tenant.js";
import type { RunArchivesRepo } from "@api/repositories/run-archives.js";
import type { RawItemsRepo } from "@api/repositories/raw-items.js";
import type { MustReadRepo } from "@api/repositories/must-read.js";
import { createPublicHomeRouter } from "@api/routes/home.js";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

const FEATURED_ROW = {
  id: "mr-1",
  url: "https://example.com/a",
  title: "A Canon Piece",
  author: "Someone",
  year: 2024,
  annotation: "Worth reading.",
  addedAt: new Date("2026-01-01T00:00:00.000Z"),
};

function buildApp(
  publicTenant: PublicTenantCtx | undefined,
): { app: Hono; findRandom: ReturnType<typeof vi.fn> } {
  const archiveRepo = {
    findLatestReviewedSince: vi.fn(() => Promise.resolve(null)),
    listReviewed: vi.fn(() => Promise.resolve([])),
  } as unknown as RunArchivesRepo;
  const findRandom = vi.fn(() => Promise.resolve(FEATURED_ROW));
  const mustReadRepo = { findRandom } as unknown as MustReadRepo;
  const app = new Hono();
  if (publicTenant) {
    app.use("*", async (c, next) => {
      c.set("publicTenant", publicTenant);
      await next();
    });
  }
  app.route(
    "/api/home",
    createPublicHomeRouter({
      getArchiveRepo: () => archiveRepo,
      getRawItemsRepo: () => ({}) as unknown as RawItemsRepo,
      getMustReadRepo: () => mustReadRepo,
    }),
  );
  return { app, findRandom };
}

async function fetchHome(app: Hono): Promise<HomePagePayload> {
  const res = await app.request("/api/home");
  expect(res.status).toBe(200);
  return (await res.json()) as HomePagePayload;
}

describe("GET /api/home — canon flag enforcement", () => {
  it("nulls featuredCanon when canon is off, even if a row exists", async () => {
    const { app } = buildApp({
      tenantId: TENANT_ID,
      slug: "inference",
      featureCanon: false,
    });
    const body = await fetchHome(app);
    expect(body.featuredCanon).toBeNull();
  });

  it("includes featuredCanon when canon is on", async () => {
    const { app } = buildApp({
      tenantId: TENANT_ID,
      slug: "inference",
      featureCanon: true,
    });
    const body = await fetchHome(app);
    expect(body.featuredCanon?.id).toBe("mr-1");
  });

  it("includes featuredCanon on the app host where no public tenant is resolved (legacy)", async () => {
    const { app } = buildApp(undefined);
    const body = await fetchHome(app);
    expect(body.featuredCanon?.id).toBe("mr-1");
  });
});
