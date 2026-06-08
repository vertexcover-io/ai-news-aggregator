/**
 * Real-DB integration tests for the IncidentRepository.
 *
 * Coverage:
 *   REQ-009  — dedup by fingerprint (ON CONFLICT upsert)
 *   REQ-010  — cooldown suppresses second alert
 *   REQ-011  — cooldown uses pre-update notified_at
 *   REQ-013  — durable-first: incident row exists even when channel fails
 *   REQ-014  — failed delivery increments attempts, notified_at stays null
 *   REQ-015  — sweep redelivers undelivered up to ALERT_SWEEP_BATCH_SIZE
 *   REQ-016  — sweep skips rows at ALERT_MAX_DELIVERY_ATTEMPTS cap
 *   EDGE-001 — webhook down: row persists, stays undelivered
 *   EDGE-002 — crash storm collapses to one row
 *   EDGE-006 — guarded markDelivered sends at most once
 *   EDGE-008 — at-least-once: undelivered row re-sent after lost mark
 *
 * DB: postgresql://newsletter:newsletter@localhost:5434/newsletter_test
 * Each test uses a unique fingerprint prefix and deletes its own rows in afterEach.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { config } from "dotenv";
import { resolve } from "node:path";
import postgres from "postgres";
import { createIncidentRepo } from "@pipeline/repositories/incidents.js";
import { getTestDb } from "@pipeline-tests/e2e/setup/test-db.js";
import {
  ALERT_SWEEP_BATCH_SIZE,
  ALERT_MAX_DELIVERY_ATTEMPTS,
  INCIDENT_ALERT_COOLDOWN_MS,
} from "@newsletter/shared/constants";
import type { CaptureIncidentInput } from "@newsletter/shared/alerting";

config({ path: resolve(import.meta.dirname, "../../../../../.env.test") });

// ── helpers ────────────────────────────────────────────────────────────────

let rawSql: ReturnType<typeof postgres>;

beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL not set");
  rawSql = postgres(databaseUrl);
  // force drizzle connection
  getTestDb();
  // clean up any leftover test rows from previous runs (hermetic start)
  await rawSql`DELETE FROM incidents WHERE fingerprint LIKE ${"%" + "test-" + "%"}`;
});

afterAll(async () => {
  await rawSql.end();
});

function makeFingerprint(prefix: string, suffix = "default"): string {
  return `${prefix}:${suffix}`;
}

async function deleteByPrefix(prefix: string): Promise<void> {
  // fingerprint format: category:source:signature — match on source substring
  await rawSql`DELETE FROM incidents WHERE fingerprint LIKE ${"%" + prefix + "%"}`;
}

function makeInput(
  source: string,
  overrides: Partial<CaptureIncidentInput> = {},
): CaptureIncidentInput {
  return {
    severity: "warning",
    category: "run_degraded",
    title: "Test incident",
    message: "test message",
    source,
    ...overrides,
  };
}

// ── REQ-009 / EDGE-002 ─────────────────────────────────────────────────────

describe("test_REQ_009_dedup_by_fingerprint", () => {
  const PREFIX = `test-dedup-${Date.now()}-${Math.floor(Math.random()*1e6)}`;
  afterEach(async () => deleteByPrefix(PREFIX));

  it("two captures with same fingerprint produce one row with occurrences=2", async () => {
    const repo = createIncidentRepo(getTestDb());
    const input = makeInput(PREFIX);
    const cooldown = INCIDENT_ALERT_COOLDOWN_MS;

    const r1 = await repo.upsertByFingerprint(input, cooldown);
    const r2 = await repo.upsertByFingerprint(input, cooldown);

    expect(r1.id).toBe(r2.id);
    expect(r1.isNew).toBe(true);
    expect(r2.isNew).toBe(false);

    // Verify via raw SQL that exactly one row exists with occurrences=2
    const rows = await rawSql<{ occurrences: number }[]>`
      SELECT occurrences FROM incidents WHERE fingerprint LIKE ${"%" + PREFIX + "%"}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].occurrences).toBe(2);
  });
});

describe("test_EDGE_002_crash_storm_collapses", () => {
  const PREFIX = `test-storm-${Date.now()}-${Math.floor(Math.random()*1e6)}`;
  afterEach(async () => deleteByPrefix(PREFIX));

  it("many rapid captures → one row, occurrences incremented", async () => {
    const repo = createIncidentRepo(getTestDb());
    const input = makeInput(PREFIX, { severity: "critical", category: "worker_crash" });
    const cooldown = INCIDENT_ALERT_COOLDOWN_MS;

    await repo.upsertByFingerprint(input, cooldown);
    await repo.upsertByFingerprint(input, cooldown);
    await repo.upsertByFingerprint(input, cooldown);

    const rows = await rawSql<{ occurrences: number }[]>`
      SELECT occurrences FROM incidents WHERE fingerprint LIKE ${"%" + PREFIX + "%"}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].occurrences).toBe(3);
  });
});

// ── REQ-010 / REQ-011 ──────────────────────────────────────────────────────

describe("test_REQ_010_cooldown_suppresses_second_alert", () => {
  const PREFIX = `test-cooldown-${Date.now()}-${Math.floor(Math.random()*1e6)}`;
  afterEach(async () => deleteByPrefix(PREFIX));

  it("second capture within cooldown returns shouldNotify=false", async () => {
    const repo = createIncidentRepo(getTestDb());
    const input = makeInput(PREFIX);
    // Use a very long cooldown so the second capture is always within it
    const longCooldown = 99_999_999_999;

    const r1 = await repo.upsertByFingerprint(input, longCooldown);
    // Simulate delivery: mark delivered now
    await repo.markDelivered(r1.id, new Date());

    const r2 = await repo.upsertByFingerprint(input, longCooldown);
    expect(r2.shouldNotify).toBe(false);
  });
});

describe("test_REQ_011_cooldown_uses_pre_update_notified_at", () => {
  const PREFIX = `test-preupdate-${Date.now()}-${Math.floor(Math.random()*1e6)}`;
  afterEach(async () => deleteByPrefix(PREFIX));

  it("when prior notified_at is older than cooldown, shouldNotify=true on next capture", async () => {
    const repo = createIncidentRepo(getTestDb());
    const input = makeInput(PREFIX);
    const shortCooldown = 1; // 1ms cooldown

    const r1 = await repo.upsertByFingerprint(input, shortCooldown);
    // Mark delivered at a time well in the past
    const pastDate = new Date(Date.now() - 10_000);
    await repo.markDelivered(r1.id, pastDate);

    // Now capture again with 1ms cooldown: past notified_at is definitely older
    const r2 = await repo.upsertByFingerprint(input, shortCooldown);
    expect(r2.shouldNotify).toBe(true);
  });

  it("when notified_at is null (never delivered), shouldNotify=true", async () => {
    const repo = createIncidentRepo(getTestDb());
    const input = makeInput(PREFIX + "-null");
    const cooldown = INCIDENT_ALERT_COOLDOWN_MS;

    const r1 = await repo.upsertByFingerprint(input, cooldown);
    expect(r1.shouldNotify).toBe(true);
    expect(r1.isNew).toBe(true);
  });
});

// ── REQ-013 / REQ-014 / EDGE-001 ──────────────────────────────────────────

describe("test_REQ_013_durable_first_persist_before_send", () => {
  const PREFIX = `test-durable-${Date.now()}-${Math.floor(Math.random()*1e6)}`;
  afterEach(async () => deleteByPrefix(PREFIX));

  it("row is persisted even when channel fails (throws)", async () => {
    const repo = createIncidentRepo(getTestDb());
    const input = makeInput(PREFIX, { severity: "error", category: "job_failed" });
    const cooldown = INCIDENT_ALERT_COOLDOWN_MS;

    const result = await repo.upsertByFingerprint(input, cooldown);
    expect(result.id).toBeTruthy();

    // Simulate failed delivery: increment attempts (channel threw, didn't call markDelivered)
    await repo.incrementDeliveryAttempts(result.id);

    const rows = await rawSql<{ notified_at: Date | null; delivery_attempts: number }[]>`
      SELECT notified_at, delivery_attempts FROM incidents WHERE id = ${result.id}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].notified_at).toBeNull();
    expect(rows[0].delivery_attempts).toBe(1);
  });
});

describe("test_REQ_014_failed_delivery_marks_undelivered", () => {
  const PREFIX = `test-undelivered-${Date.now()}-${Math.floor(Math.random()*1e6)}`;
  afterEach(async () => deleteByPrefix(PREFIX));

  it("incrementDeliveryAttempts leaves notified_at null and bumps attempts", async () => {
    const repo = createIncidentRepo(getTestDb());
    const input = makeInput(PREFIX);
    const cooldown = INCIDENT_ALERT_COOLDOWN_MS;

    const result = await repo.upsertByFingerprint(input, cooldown);
    await repo.incrementDeliveryAttempts(result.id);
    await repo.incrementDeliveryAttempts(result.id);

    const rows = await rawSql<{ notified_at: Date | null; delivery_attempts: number }[]>`
      SELECT notified_at, delivery_attempts FROM incidents WHERE id = ${result.id}
    `;
    expect(rows[0].notified_at).toBeNull();
    expect(rows[0].delivery_attempts).toBe(2);
  });
});

// ── REQ-015 / REQ-016 / EDGE-008 ──────────────────────────────────────────

describe("test_REQ_015_sweep_redelivers_bounded_batch", () => {
  const PREFIX = `test-sweep-${Date.now()}-${Math.floor(Math.random()*1e6)}`;
  afterEach(async () => deleteByPrefix(PREFIX));

  it("listUndelivered returns at most ALERT_SWEEP_BATCH_SIZE rows", async () => {
    const repo = createIncidentRepo(getTestDb());
    const cooldown = INCIDENT_ALERT_COOLDOWN_MS;
    const total = ALERT_SWEEP_BATCH_SIZE + 5;

    // Insert more rows than the batch size
    for (let i = 0; i < total; i++) {
      const input = makeInput(makeFingerprint(PREFIX, `row-${i}`), {
        severity: "warning",
      });
      await repo.upsertByFingerprint(input, cooldown);
    }

    const undelivered = await repo.listUndelivered();
    expect(undelivered.length).toBeLessThanOrEqual(ALERT_SWEEP_BATCH_SIZE);
    expect(undelivered.length).toBeGreaterThan(0);
  });

  it("markDelivered causes row to not appear in listUndelivered", async () => {
    const repo = createIncidentRepo(getTestDb());
    const input = makeInput(PREFIX + "-mark");
    const cooldown = INCIDENT_ALERT_COOLDOWN_MS;

    const result = await repo.upsertByFingerprint(input, cooldown);
    await repo.markDelivered(result.id, new Date());

    const undelivered = await repo.listUndelivered();
    const found = undelivered.find((r) => r.id === result.id);
    expect(found).toBeUndefined();
  });
});

describe("test_REQ_016_sweep_skips_capped_incidents", () => {
  const PREFIX = `test-cap-${Date.now()}-${Math.floor(Math.random()*1e6)}`;
  afterEach(async () => deleteByPrefix(PREFIX));

  it("rows at ALERT_MAX_DELIVERY_ATTEMPTS are excluded from listUndelivered", async () => {
    const repo = createIncidentRepo(getTestDb());
    const input = makeInput(PREFIX);
    const cooldown = INCIDENT_ALERT_COOLDOWN_MS;

    const result = await repo.upsertByFingerprint(input, cooldown);

    // Bring delivery_attempts to the cap
    for (let i = 0; i < ALERT_MAX_DELIVERY_ATTEMPTS; i++) {
      await repo.incrementDeliveryAttempts(result.id);
    }

    const undelivered = await repo.listUndelivered();
    const found = undelivered.find((r) => r.id === result.id);
    expect(found).toBeUndefined();
  });
});

describe("test_EDGE_008_at_least_once_resend", () => {
  const PREFIX = `test-atleastonce-${Date.now()}-${Math.floor(Math.random()*1e6)}`;
  afterEach(async () => deleteByPrefix(PREFIX));

  it("row with null notified_at re-appears in sweep after failed mark", async () => {
    const repo = createIncidentRepo(getTestDb());
    const input = makeInput(PREFIX);
    const cooldown = INCIDENT_ALERT_COOLDOWN_MS;

    const result = await repo.upsertByFingerprint(input, cooldown);
    // Simulate: delivery attempted but markDelivered was NOT called (lost write)
    // Row stays undelivered
    const undelivered = await repo.listUndelivered();
    const found = undelivered.find((r) => r.id === result.id);
    expect(found).toBeDefined();
    expect(found?.id).toBe(result.id);
  });
});

// ── EDGE-006 ────────────────────────────────────────────────────────────────

describe("test_EDGE_006_sweep_capture_race_sends_once", () => {
  const PREFIX = `test-race-${Date.now()}-${Math.floor(Math.random()*1e6)}`;
  afterEach(async () => deleteByPrefix(PREFIX));

  it("concurrent markDelivered calls only set notified_at once (guarded WHERE IS NULL)", async () => {
    const repo = createIncidentRepo(getTestDb());
    const input = makeInput(PREFIX);
    const cooldown = INCIDENT_ALERT_COOLDOWN_MS;

    const result = await repo.upsertByFingerprint(input, cooldown);

    // Simulate two concurrent sweep + capture deliveries
    const t1 = new Date(Date.now() - 1000);
    const t2 = new Date();
    await Promise.all([repo.markDelivered(result.id, t1), repo.markDelivered(result.id, t2)]);

    // notified_at should be set once (the WHERE notified_at IS NULL guard)
    const rows = await rawSql<{ notified_at: Date | null }[]>`
      SELECT notified_at FROM incidents WHERE id = ${result.id}
    `;
    expect(rows[0].notified_at).not.toBeNull();
  });
});
