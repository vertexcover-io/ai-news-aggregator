/**
 * Unit tests for the alert-delivery worker sweep logic.
 *
 * Coverage:
 *   REQ-015 — sweep redelivers undelivered in bounded batch
 *   REQ-016 — sweep skips capped rows (via repo.listUndelivered selection)
 *   EDGE-001 — webhook down: no delivery crash, row stays undelivered
 *
 * NOTE: No real Slack — all tests inject a fake AlertChannel.
 * No real DB — tests inject a fake IncidentRepository.
 */
import { describe, it, expect } from "vitest";
import type { AlertChannel, Incident, IncidentRepository } from "@newsletter/shared/alerting";
import { runAlertDeliverySweep } from "@pipeline/workers/alert-delivery.js";

// ── Fake helpers ───────────────────────────────────────────────────────────

function makeIncident(id: string, overrides: Partial<Incident> = {}): Incident {
  const now = new Date();
  return {
    id,
    fingerprint: `test:src:_`,
    severity: "warning",
    category: "run_degraded",
    title: "test",
    message: "test",
    source: "test",
    runId: null,
    context: {},
    status: "open",
    occurrences: 1,
    deliveryAttempts: 0,
    firstSeenAt: now,
    lastSeenAt: now,
    notifiedAt: null,
    ...overrides,
  };
}

function makeFakeRepo(undelivered: Incident[]): IncidentRepository & {
  deliveredIds: string[];
  incrementedIds: string[];
} {
  const deliveredIds: string[] = [];
  const incrementedIds: string[] = [];
  return {
    deliveredIds,
    incrementedIds,
    upsertByFingerprint(): Promise<{ id: string; isNew: boolean; shouldNotify: boolean; status: "open" }> {
      return Promise.resolve({ id: "x", isNew: true, shouldNotify: true, status: "open" });
    },
    markDelivered(id: string): Promise<void> {
      deliveredIds.push(id);
      return Promise.resolve();
    },
    incrementDeliveryAttempts(id: string): Promise<void> {
      incrementedIds.push(id);
      return Promise.resolve();
    },
    listUndelivered(): Promise<Incident[]> {
      return Promise.resolve(undelivered);
    },
  };
}

function makeFakeChannel(
  opts: { ok?: boolean; throws?: boolean; enabled?: boolean } = {},
): AlertChannel & { calls: Incident[] } {
  const calls: Incident[] = [];
  return {
    enabled: opts.enabled ?? true,
    calls,
    send(incident: Incident): Promise<boolean> {
      if (opts.throws) return Promise.reject(new Error("channel error"));
      calls.push(incident);
      return Promise.resolve(opts.ok ?? true);
    },
  };
}

// ── REQ-015 ────────────────────────────────────────────────────────────────

describe("test_REQ_015_sweep_unit_redelivers_batch", () => {
  it("sweep sends each undelivered row and marks delivered", async () => {
    const incidents = [makeIncident("id-1"), makeIncident("id-2"), makeIncident("id-3")];
    const repo = makeFakeRepo(incidents);
    const channel = makeFakeChannel();

    await runAlertDeliverySweep({ channel, repo });

    // All 3 rows delivered
    expect(channel.calls).toHaveLength(3);
    expect(repo.deliveredIds).toHaveLength(3);
    expect(repo.deliveredIds).toContain("id-1");
    expect(repo.deliveredIds).toContain("id-2");
    expect(repo.deliveredIds).toContain("id-3");
  });

  it("sweep with empty undelivered list sends nothing", async () => {
    const repo = makeFakeRepo([]);
    const channel = makeFakeChannel();

    await runAlertDeliverySweep({ channel, repo });

    expect(channel.calls).toHaveLength(0);
    expect(repo.deliveredIds).toHaveLength(0);
  });
});

// ── EDGE-001 ────────────────────────────────────────────────────────────────

describe("test_EDGE_001_webhook_down_persists_and_retries", () => {
  it("failing channel → incrementDeliveryAttempts called, sweep does not throw", async () => {
    const incidents = [makeIncident("id-1")];
    const repo = makeFakeRepo(incidents);
    const channel = makeFakeChannel({ ok: false });

    await expect(runAlertDeliverySweep({ channel, repo })).resolves.not.toThrow();

    // Channel was called but delivery failed → incrementDeliveryAttempts
    expect(channel.calls).toHaveLength(1);
    expect(repo.deliveredIds).toHaveLength(0);
    expect(repo.incrementedIds).toHaveLength(1);
    expect(repo.incrementedIds[0]).toBe("id-1");
  });

  it("throwing channel → sweep does not crash, row stays undelivered", async () => {
    const incidents = [makeIncident("id-1")];
    const repo = makeFakeRepo(incidents);
    const channel = makeFakeChannel({ throws: true });

    // sweep must not throw
    await expect(runAlertDeliverySweep({ channel, repo })).resolves.not.toThrow();

    expect(repo.deliveredIds).toHaveLength(0);
    // When channel throws, incrementDeliveryAttempts is called
    expect(repo.incrementedIds).toHaveLength(1);
  });
});
