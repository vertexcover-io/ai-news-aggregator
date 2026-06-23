/**
 * Integration tests for the extension submissions service and routes.
 * Tests: REQ-005, REQ-006, REQ-008, EDGE-003, EDGE-004.
 * Requires a running PostgreSQL (pnpm infra:up).
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
} from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { eq, and, inArray } from "drizzle-orm";
import { getDb, rawItems } from "@newsletter/shared/db";
import { createRawItemsRepo } from "@api/repositories/raw-items.js";
import {
  createUserSubmission,
  hashUrl,
} from "@api/services/user-submissions.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
config({ path: resolve(REPO_ROOT, ".env") });

const db = getDb();
const rawItemsRepo = createRawItemsRepo(db);

const TEST_PREFIX = `ext-e2e-${String(Date.now())}`;
const seededIds = new Set<number>();

async function cleanup(): Promise<void> {
  if (seededIds.size === 0) return;
  // Delete ONLY the rows this test run seeded — never all "manual" rows, which
  // would destroy real submissions if pointed at a shared/dev DB.
  await db.delete(rawItems).where(inArray(rawItems.id, [...seededIds]));
  seededIds.clear();
}

beforeAll(async () => {
  // Verify DB connection
  await db.select({ id: rawItems.id }).from(rawItems).limit(1);
});

afterEach(cleanup);
afterAll(cleanup);

async function countManualRows(externalId: string): Promise<number> {
  const rows = await db
    .select({ id: rawItems.id })
    .from(rawItems)
    .where(
      and(
        eq(rawItems.sourceType, "manual"),
        eq(rawItems.externalId, externalId),
      ),
    );
  return rows.length;
}

describe("createUserSubmission", () => {
  it("test_REQ_005_submission_inserts_manual_raw_item: inserts a raw_item with sourceType=manual", async () => {
    const url = `https://example.com/article-${TEST_PREFIX}`;
    const result = await createUserSubmission(
      { url },
      {
        rawItemsRepo,
        enrichUrl: () => Promise.resolve({ title: "Enriched Title", author: "Author" }),
      },
    );

    expect(result.sourceType).toBe("manual");
    expect(result.url).toBe(url);
    expect(result.title).toBe("Enriched Title");
    expect(result.alreadyExisted).toBe(false);
    expect(result.id).toBeTypeOf("number");
    seededIds.add(result.id);

    // Verify row in DB
    const row = await rawItemsRepo.findBySourceAndExternalId("manual", hashUrl(url));
    expect(row).not.toBeNull();
    expect(row?.sourceType).toBe("manual");
  });

  it("test_REQ_006_resubmit_upserts_no_duplicate: second submission returns alreadyExisted=true with one DB row", async () => {
    const url = `https://example.com/same-article-${TEST_PREFIX}`;
    const { canonicalizeUrl } = await import("@newsletter/pipeline/add-post");
    const externalId = hashUrl(canonicalizeUrl(url));

    const first = await createUserSubmission(
      { url },
      {
        rawItemsRepo,
        enrichUrl: () => Promise.resolve({ title: "First Title" }),
      },
    );
    seededIds.add(first.id);

    const second = await createUserSubmission(
      { url },
      {
        rawItemsRepo,
        enrichUrl: () => Promise.resolve({ title: "Updated Title" }),
      },
    );

    expect(second.alreadyExisted).toBe(true);
    expect(second.id).toBe(first.id);

    // Only one row in DB
    const count = await countManualRows(externalId);
    expect(count).toBe(1);
  });

  it("test_REQ_008_enrichment_failure_falls_back_to_url: stores URL as title when enrichment throws (EDGE-004)", async () => {
    const url = `https://example.com/enrich-fail-${TEST_PREFIX}`;

    const result = await createUserSubmission(
      { url },
      {
        rawItemsRepo,
        enrichUrl: () => Promise.reject(new Error("network timeout")),
      },
    );

    expect(result.title).toBe(url);
    expect(result.sourceType).toBe("manual");
    seededIds.add(result.id);
  });

  it("test_EDGE_003_tracking_params_dedupe: URLs differing only by utm_ params collapse to same externalId", async () => {
    const base = `https://example.com/canonical-${TEST_PREFIX}`;
    const withUtm = `${base}?utm_source=twitter&utm_medium=social`;

    const first = await createUserSubmission(
      { url: base },
      {
        rawItemsRepo,
        enrichUrl: () => Promise.resolve({ title: "Base Title" }),
      },
    );
    seededIds.add(first.id);

    const second = await createUserSubmission(
      { url: withUtm },
      {
        rawItemsRepo,
        enrichUrl: () => Promise.resolve({ title: "UTM Title" }),
      },
    );

    // Same externalId — should deduplicate
    expect(second.alreadyExisted).toBe(true);

    const { canonicalizeUrl } = await import("@newsletter/pipeline/add-post");
    const externalId = hashUrl(canonicalizeUrl(base));
    const count = await countManualRows(externalId);
    expect(count).toBe(1);
  });
});
