/**
 * E2E integration tests for the API IncidentRepository.
 *
 * Uses the live Postgres at DATABASE_URL (postgresql://newsletter:newsletter@localhost:5434/newsletter_test).
 * Each test uses a UNIQUE fingerprint prefix to avoid cross-test pollution.
 * Cleanup: afterEach/afterAll deletes rows with matching source prefix.
 *
 * REQ-020, REQ-021, EDGE-009 (list/setStatus methods).
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { sql } from "drizzle-orm";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
config({ path: resolve(REPO_ROOT, ".env") });

// Set DATABASE_URL to test DB if not already set
process.env.DATABASE_URL ??= "postgresql://newsletter:newsletter@localhost:5434/newsletter_test";

const { getDb } = await import("@newsletter/shared/db");
const { createIncidentRepo } = await import("@api/repositories/incidents.js");

const db = getDb();
const repo = createIncidentRepo(db);

const TEST_PREFIX = `test-api-incidents-repo-e2e-${Date.now()}`;

async function cleanUp(): Promise<void> {
  await db.execute(sql`DELETE FROM incidents WHERE source LIKE ${TEST_PREFIX + "%"}`);
}

beforeAll(cleanUp);
afterAll(cleanUp);
afterEach(cleanUp);

function makeInput(
  suffix: string,
  overrides: Partial<{
    severity: "error" | "warning" | "critical" | "info";
    category: "api_5xx" | "api_crash" | "run_degraded";
    source: string;
    title: string;
    message: string;
  }> = {},
) {
  return {
    severity: "error" as const,
    category: "api_5xx" as const,
    title: `Test incident ${suffix}`,
    message: `Error message for ${suffix}`,
    source: `${TEST_PREFIX}-${suffix}`,
    ...overrides,
  };
}

describe("createIncidentRepo (API) — list + setStatus", () => {
  it("test_REQ_020_list_incidents_filtered — list returns rows newest-first filterable by status/severity", async () => {
    const suffix = "list-filter";
    const input1 = makeInput(`${suffix}-a`);
    const input2 = makeInput(`${suffix}-b`, { severity: "warning", category: "run_degraded" });

    // Insert two incidents
    await repo.upsertByFingerprint(input1, 3_600_000);
    // Small delay to ensure distinct lastSeenAt for ordering test
    await new Promise<void>((r) => setTimeout(r, 10));
    await repo.upsertByFingerprint(input2, 3_600_000);

    // List all (open)
    const all = await repo.list({ status: "open" });
    const ours = all.filter((r) => r.source?.startsWith(`${TEST_PREFIX}-${suffix}`));
    expect(ours.length).toBe(2);

    // Verify newest-first ordering (lastSeenAt DESC)
    for (let i = 0; i < ours.length - 1; i++) {
      expect(ours[i].lastSeenAt.getTime()).toBeGreaterThanOrEqual(ours[i + 1].lastSeenAt.getTime());
    }

    // List only error severity
    const errOnly = await repo.list({ status: "open", severity: "error" });
    const ourErr = errOnly.filter((r) => r.source?.startsWith(`${TEST_PREFIX}-${suffix}`));
    expect(ourErr.length).toBe(1);
    expect(ourErr[0].severity).toBe("error");

    // List only warning severity
    const warnOnly = await repo.list({ severity: "warning" });
    const ourWarn = warnOnly.filter((r) => r.source?.startsWith(`${TEST_PREFIX}-${suffix}`));
    expect(ourWarn.length).toBe(1);
    expect(ourWarn[0].severity).toBe("warning");
  });

  it("test_REQ_021_patch_status_updates_incident — setStatus updates the incident status", async () => {
    const suffix = "set-status";
    const input = makeInput(suffix);
    const { id } = await repo.upsertByFingerprint(input, 3_600_000);

    const updated = await repo.setStatus(id, "resolved");
    expect(updated).not.toBeNull();
    expect(updated?.status).toBe("resolved");
    expect(updated?.id).toBe(id);

    // Verify persistence — list should reflect it
    const rows = await repo.list({});
    const found = rows.find((r) => r.id === id);
    expect(found?.status).toBe("resolved");
  });

  it("setStatus to muted also persists", async () => {
    const suffix = "set-muted";
    const input = makeInput(suffix);
    const { id } = await repo.upsertByFingerprint(input, 3_600_000);

    const updated = await repo.setStatus(id, "muted");
    expect(updated?.status).toBe("muted");
  });

  it("setStatus returns null for unknown id", async () => {
    const nonExistent = "00000000-0000-0000-0000-000000000000";
    const result = await repo.setStatus(nonExistent, "resolved");
    expect(result).toBeNull();
  });

  it("list with no filter returns all incidents without error", async () => {
    // Verify it doesn't throw on empty result set
    const rows = await repo.list();
    expect(Array.isArray(rows)).toBe(true);
  });
});
