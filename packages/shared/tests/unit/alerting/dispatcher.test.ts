import { describe, it, expect, vi } from "vitest";
import { createAlertDispatcher } from "../../../src/alerting/dispatcher.js";
import type { IncidentRepository, AlertChannel, Incident, UpsertResult, CaptureIncidentInput } from "../../../src/types/incident.js";

// Incident type is used in channel send type parameter
type _Incident = Incident;

// ── helpers ──────────────────────────────────────────────────────────────────

function makeUpsertResult(overrides: Partial<UpsertResult> = {}): UpsertResult {
  return {
    id: "incident-1",
    isNew: true,
    shouldNotify: true,
    status: "open",
    ...overrides,
  };
}

interface FakeRepo {
  repo: IncidentRepository;
  upsertByFingerprint: ReturnType<typeof vi.fn>;
  markDelivered: ReturnType<typeof vi.fn>;
  incrementDeliveryAttempts: ReturnType<typeof vi.fn>;
}

function makeRepo(upsertResult: UpsertResult): FakeRepo {
  const upsertByFingerprint = vi.fn().mockResolvedValue(upsertResult);
  const markDelivered = vi.fn().mockResolvedValue(undefined);
  const incrementDeliveryAttempts = vi.fn().mockResolvedValue(undefined);
  return {
    repo: { upsertByFingerprint, markDelivered, incrementDeliveryAttempts },
    upsertByFingerprint,
    markDelivered,
    incrementDeliveryAttempts,
  };
}

interface FakeChannel {
  channel: AlertChannel;
  send: ReturnType<typeof vi.fn>;
}

function makeChannel(enabled: boolean, sendResult: boolean): FakeChannel {
  const send = vi.fn<[Incident], Promise<boolean>>().mockResolvedValue(sendResult);
  return { channel: { enabled, send }, send };
}

const baseInput: CaptureIncidentInput = {
  severity: "error",
  category: "job_failed",
  title: "Test incident",
  message: "Test message",
};

const fakeNow = new Date("2026-06-01T12:00:00Z");
const fakeClock = { now: () => fakeNow };

// ── tests ────────────────────────────────────────────────────────────────────

describe("createAlertDispatcher", () => {
  it("test_REQ_012_info_severity_never_alerts: info severity does not call send", async () => {
    const { repo } = makeRepo(makeUpsertResult({ shouldNotify: true }));
    const { channel, send } = makeChannel(true, true);
    const dispatcher = createAlertDispatcher({ repo, channels: [channel], clock: fakeClock });

    await dispatcher.capture({ ...baseInput, severity: "info" });

    expect(send).not.toHaveBeenCalled();
  });

  it("test_REQ_010_cooldown (shouldNotify=false) suppresses send", async () => {
    const { repo } = makeRepo(makeUpsertResult({ shouldNotify: false }));
    const { channel, send } = makeChannel(true, true);
    const dispatcher = createAlertDispatcher({ repo, channels: [channel], clock: fakeClock });

    await dispatcher.capture(baseInput);

    expect(send).not.toHaveBeenCalled();
  });

  it("test_REQ_022_muted_counts_no_alert: muted status suppresses send even if shouldNotify=true", async () => {
    const { repo } = makeRepo(makeUpsertResult({ shouldNotify: true, status: "muted" }));
    const { channel, send } = makeChannel(true, true);
    const dispatcher = createAlertDispatcher({ repo, channels: [channel], clock: fakeClock });

    await dispatcher.capture(baseInput);

    expect(send).not.toHaveBeenCalled();
  });

  it("test_REQ_019_slack_unset_skips_delivery: disabled channel → persist only, no send, no throw", async () => {
    const { repo, upsertByFingerprint } = makeRepo(makeUpsertResult({ shouldNotify: true }));
    const { channel, send } = makeChannel(false, false);
    const dispatcher = createAlertDispatcher({ repo, channels: [channel], clock: fakeClock });

    await expect(dispatcher.capture(baseInput)).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
    expect(upsertByFingerprint).toHaveBeenCalled();
  });

  it("test_REQ_017_capture_never_throws: repo rejects → capture resolves (no throw)", async () => {
    const upsertByFingerprint = vi.fn().mockRejectedValue(new Error("DB down"));
    const repo: IncidentRepository = {
      upsertByFingerprint,
      markDelivered: vi.fn(),
      incrementDeliveryAttempts: vi.fn(),
    };
    const { channel } = makeChannel(true, true);
    const dispatcher = createAlertDispatcher({ repo, channels: [channel], clock: fakeClock });

    await expect(dispatcher.capture(baseInput)).resolves.toBeUndefined();
  });

  it("test_REQ_018_persist_failure_logs_fatal: repo rejects → fatal log emitted", async () => {
    const fatalSpy = vi.fn();
    const logger = { fatal: fatalSpy };
    const upsertByFingerprint = vi.fn().mockRejectedValue(new Error("DB down"));
    const repo: IncidentRepository = {
      upsertByFingerprint,
      markDelivered: vi.fn(),
      incrementDeliveryAttempts: vi.fn(),
    };
    const dispatcher = createAlertDispatcher({
      repo,
      channels: [],
      logger: logger as Parameters<typeof createAlertDispatcher>[0]["logger"],
      clock: fakeClock,
    });

    await dispatcher.capture(baseInput);

    expect(fatalSpy).toHaveBeenCalledOnce();
  });

  it("test_EDGE_003_db_down_logs_fatal_no_throw: same harness as REQ-018", async () => {
    const fatalSpy = vi.fn();
    const logger = { fatal: fatalSpy };
    const upsertByFingerprint = vi.fn().mockRejectedValue(new Error("connection refused"));
    const repo: IncidentRepository = {
      upsertByFingerprint,
      markDelivered: vi.fn(),
      incrementDeliveryAttempts: vi.fn(),
    };
    const dispatcher = createAlertDispatcher({
      repo,
      channels: [],
      logger: logger as Parameters<typeof createAlertDispatcher>[0]["logger"],
      clock: fakeClock,
    });

    await expect(dispatcher.capture(baseInput)).resolves.toBeUndefined();
    expect(fatalSpy).toHaveBeenCalled();
  });

  it("successful send calls markDelivered with correct timestamp", async () => {
    const { repo, markDelivered } = makeRepo(makeUpsertResult({ shouldNotify: true }));
    const { channel } = makeChannel(true, true);
    const dispatcher = createAlertDispatcher({ repo, channels: [channel], clock: fakeClock });

    await dispatcher.capture(baseInput);

    expect(markDelivered).toHaveBeenCalledWith("incident-1", fakeNow);
  });

  it("test_REQ_014_failed_delivery_marks_undelivered: failed send increments attempts, no markDelivered", async () => {
    const { repo, incrementDeliveryAttempts, markDelivered } = makeRepo(makeUpsertResult({ shouldNotify: true }));
    const { channel } = makeChannel(true, false); // send returns false
    const dispatcher = createAlertDispatcher({ repo, channels: [channel], clock: fakeClock });

    await dispatcher.capture(baseInput);

    expect(incrementDeliveryAttempts).toHaveBeenCalledWith("incident-1");
    expect(markDelivered).not.toHaveBeenCalled();
  });

  it("test_REQ_011_cooldown_uses_pre_update_notified_at: shouldNotify computed by repo, dispatcher trusts it", async () => {
    // The dispatcher does NOT recompute cooldown — it trusts shouldNotify from repo (REQ-011).
    // Here we verify that when repo says shouldNotify=true, send IS called.
    const { repo } = makeRepo(makeUpsertResult({ shouldNotify: true }));
    const { channel, send } = makeChannel(true, true);
    const dispatcher = createAlertDispatcher({ repo, channels: [channel], clock: fakeClock });

    await dispatcher.capture(baseInput);

    expect(send).toHaveBeenCalled();
  });

  it("no channels configured → persist only, no throw", async () => {
    const { repo, upsertByFingerprint } = makeRepo(makeUpsertResult({ shouldNotify: true }));
    const dispatcher = createAlertDispatcher({ repo, channels: [], clock: fakeClock });

    await expect(dispatcher.capture(baseInput)).resolves.toBeUndefined();
    expect(upsertByFingerprint).toHaveBeenCalled();
  });
});
