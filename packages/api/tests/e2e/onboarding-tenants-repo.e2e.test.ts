/**
 * Phase 11 e2e: tenants-repo onboarding surface against the real DB.
 * Verifies the slug-race contract end-to-end (EDGE-001 — the 23505 detection
 * depends on the real driver's error shape), previous_slug recording for the
 * 301 path, placeholder-slug exclusion, and onboarding jsonb round-tripping
 * (REQ-030/033).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { sql } from "drizzle-orm";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
config({ path: resolve(REPO_ROOT, ".env") });

const { getDb } = await import("@newsletter/shared/db");
const { createTenantsRepo } = await import("@api/repositories/tenants.js");

const db = getDb();
const repo = createTenantsRepo(db);

const SLUG_PREFIX = "onb-e2e";
const tenantIds = { a: "", b: "" };

async function cleanup(): Promise<void> {
  await db.execute(
    sql`DELETE FROM tenants WHERE slug LIKE ${`${SLUG_PREFIX}%`} OR slug LIKE ${"pending-onbe2e%"}`,
  );
}

beforeAll(async () => {
  await cleanup();
  const a = await db.execute<{ id: string }>(sql`
    INSERT INTO tenants (slug, name, status)
    VALUES (${"pending-onbe2e1"}, 'Onboarding E2E A', 'pending_setup')
    RETURNING id
  `);
  tenantIds.a = a[0].id;
  const b = await db.execute<{ id: string }>(sql`
    INSERT INTO tenants (slug, name, status)
    VALUES (${`${SLUG_PREFIX}-claimed`}, 'Onboarding E2E B', 'active')
    RETURNING id
  `);
  tenantIds.b = b[0].id;
});

afterAll(async () => {
  await cleanup();
});

describe("tenants repo onboarding surface (e2e)", () => {
  it("EDGE-001: claiming another tenant's slug loses via the unique constraint", async () => {
    const result = await repo.setSlug(tenantIds.a, `${SLUG_PREFIX}-claimed`);
    expect(result).toEqual({ ok: false, reason: "taken" });
    const state = await repo.getOnboardingState(tenantIds.a);
    expect(state?.slug).toBe("pending-onbe2e1");
  });

  it("isSlugTaken excludes the asking tenant", async () => {
    expect(await repo.isSlugTaken(`${SLUG_PREFIX}-claimed`, tenantIds.a)).toBe(true);
    expect(await repo.isSlugTaken(`${SLUG_PREFIX}-claimed`, tenantIds.b)).toBe(false);
    expect(await repo.isSlugTaken(`${SLUG_PREFIX}-free`, tenantIds.a)).toBe(false);
  });

  it("placeholder slugs are never recorded as previous_slug; real ones are", async () => {
    const first = await repo.setSlug(tenantIds.a, `${SLUG_PREFIX}-first`);
    expect(first).toEqual({
      ok: true,
      slug: `${SLUG_PREFIX}-first`,
      previousSlug: null,
    });

    const second = await repo.setSlug(tenantIds.a, `${SLUG_PREFIX}-second`);
    expect(second).toEqual({
      ok: true,
      slug: `${SLUG_PREFIX}-second`,
      previousSlug: `${SLUG_PREFIX}-first`,
    });

    // The 301 path resolves the old slug to this tenant.
    const byPrevious = await repo.findByPreviousSlug(`${SLUG_PREFIX}-first`);
    expect(byPrevious?.id).toBe(tenantIds.a);
  });

  it("setting the current slug again is a no-op success", async () => {
    const result = await repo.setSlug(tenantIds.a, `${SLUG_PREFIX}-second`);
    expect(result.ok).toBe(true);
    const state = await repo.getOnboardingState(tenantIds.a);
    expect(state?.slug).toBe(`${SLUG_PREFIX}-second`);
  });

  it("REQ-030: onboarding jsonb round-trips through update/get", async () => {
    await repo.updateOnboarding(tenantIds.a, {
      furthestStep: 4,
      completed: ["name", "slug", "homepage"],
    });
    const state = await repo.getOnboardingState(tenantIds.a);
    expect(state?.onboarding).toEqual({
      furthestStep: 4,
      completed: ["name", "slug", "homepage"],
    });
  });

  it("REQ-032: the prompt description round-trips through the onboarding jsonb", async () => {
    await repo.updateOnboarding(tenantIds.a, {
      furthestStep: 4,
      completed: ["name", "slug"],
      description: "Daily robotics + embodied AI digest",
    });
    const state = await repo.getOnboardingState(tenantIds.a);
    expect(state?.onboarding?.description).toBe(
      "Daily robotics + embodied AI digest",
    );
  });
});

// At this point tenant A holds slug `-second` with previous_slug `-first`.
describe("EDGE-002: another tenant's previous_slug is not claimable (F-SLUG-1)", () => {
  it("isSlugTaken treats a foreign previous_slug as taken", async () => {
    expect(await repo.isSlugTaken(`${SLUG_PREFIX}-first`, tenantIds.b)).toBe(true);
  });

  it("setSlug rejects a foreign previous_slug, keeping the 301 redirect intact", async () => {
    const result = await repo.setSlug(tenantIds.b, `${SLUG_PREFIX}-first`);
    expect(result).toEqual({ ok: false, reason: "taken" });
    const state = await repo.getOnboardingState(tenantIds.b);
    expect(state?.slug).toBe(`${SLUG_PREFIX}-claimed`);
    const byPrevious = await repo.findByPreviousSlug(`${SLUG_PREFIX}-first`);
    expect(byPrevious?.id).toBe(tenantIds.a);
  });

  it("a tenant can still reclaim its OWN previous_slug", async () => {
    expect(await repo.isSlugTaken(`${SLUG_PREFIX}-first`, tenantIds.a)).toBe(false);
    const result = await repo.setSlug(tenantIds.a, `${SLUG_PREFIX}-first`);
    expect(result).toEqual({
      ok: true,
      slug: `${SLUG_PREFIX}-first`,
      previousSlug: `${SLUG_PREFIX}-second`,
    });
  });
});
