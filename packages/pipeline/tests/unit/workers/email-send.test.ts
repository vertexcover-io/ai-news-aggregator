import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailSendDeps } from "@pipeline/workers/email-send.js";
import type { PipelineRunArchiveRow } from "@pipeline/repositories/run-archives.js";
import type { SubscriberSelect } from "@newsletter/shared";
import { EmailSendError } from "@newsletter/shared";

const { handleEmailSendJob, resolveSendRate, getSharedPacer, resetSharedPacerForTests, createSendPacer } = await import("@pipeline/workers/email-send.js");
const { handleLinkedInPostJob } = await import("@pipeline/workers/linkedin-post.js");

function makeSubscriber(overrides: Partial<SubscriberSelect> = {}): SubscriberSelect {
  return {
    id: "sub-1",
    email: "test@example.com",
    status: "confirmed",
    confirmToken: null,
    confirmTokenExpiresAt: null,
    subscribedAt: new Date("2026-01-01T00:00:00.000Z"),
    unsubscribedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function makeArchive(
  overrides: Partial<PipelineRunArchiveRow> = {},
): PipelineRunArchiveRow {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    status: "completed",
    rankedItems: [{ rawItemId: 1, score: 0.9, rationale: "ok" }],
    topN: 5,
    reviewed: true,
    completedAt: new Date("2026-05-18T09:00:00.000Z"),
    digestHeadline: "Agents reshape developer tools",
    digestSummary: "A concise digest summary.",
    hook: null,
    twitterSummary: null,
    sourceTelemetry: null,
    slackNotifiedAt: null,
    emailSentAt: null,
    linkedinPostedAt: null,
    twitterPostedAt: null,
    notificationState: null,
    ...overrides,
  };
}

function makeDeps(
  latestArchive: PipelineRunArchiveRow | null,
  overrides: Partial<EmailSendDeps> = {},
): EmailSendDeps {
  const archive = latestArchive ?? makeArchive();
  return {
    emailProvider: {
      send: vi.fn(() => Promise.resolve({ messageId: "msg-1" })),
    },
    subscribersRepo: {
      listConfirmed: vi.fn(() => Promise.resolve([makeSubscriber()])),
      findByIds: vi.fn(() => Promise.resolve([makeSubscriber()])),
    },
    emailSendsRepo: {
      create: vi.fn(() => Promise.resolve({ id: "send-1" })),
      findSentSubscriberIds: vi.fn(() => Promise.resolve(new Set<string>())),
    },
    archiveRepo: {
      upsert: vi.fn(() => Promise.resolve()),
      findById: vi.fn(() => Promise.resolve(archive)),
      findLatestTerminal: vi.fn(() => Promise.resolve(latestArchive)),
      markSlackNotified: vi.fn(() => Promise.resolve()),
      markEmailSent: vi.fn(() => Promise.resolve()),
      markNotification: vi.fn(() => Promise.resolve()),
      markLinkedInPosted: vi.fn(() => Promise.resolve()),
      markTwitterPosted: vi.fn(() => Promise.resolve()),
      recordSocialFailure: vi.fn(() => Promise.resolve()),
    },
    rawItemsRepo: {
      upsertItems: vi.fn(),
      findExistingExternalIds: vi.fn(() => Promise.resolve(new Set<string>())),
      findBySourceAndExternalId: vi.fn(() => Promise.resolve(null)),
      findByIds: vi.fn(() =>
        Promise.resolve([
          {
            id: 1,
            sourceType: "hn",
            externalId: "hn-1",
            title: "Story title",
            url: "https://example.com/story",
            sourceUrl: null,
            author: null,
            content: null,
            imageUrl: null,
            publishedAt: null,
            engagement: { points: 10, commentCount: 1 },
            metadata: { comments: [] },
          },
        ]),
      ),
      updateRecapData: vi.fn(),
      listForRun: vi.fn(() => Promise.resolve([])),
    },
    // Default: a verified tenant — the broadcast gate is consulted and passes.
    // Gate-behavior tests override this with pending/failed/null statuses.
    tenantsRepo: {
      getSendingDomainStatus: vi.fn(() => Promise.resolve("verified" as const)),
    },
    renderNewsletter: vi.fn(() => Promise.resolve("<html>newsletter</html>")),
    sessionSecret: "secret",
    fromMail: "newsletter@example.com",
    baseUrl: "https://newsletter.example.com",
    slackNotifier: {
      notifyNewsletterSent: vi.fn(() => Promise.resolve()),
      notifyReviewPending: vi.fn(() => Promise.resolve()),
      notifyReviewWarning: vi.fn(() => Promise.resolve()),
      notifyPublishFailed: vi.fn(() => Promise.resolve()),
      notifyPublishUnavailable: vi.fn(() => Promise.resolve()),
      notifySourceDistribution: vi.fn(() => Promise.resolve()),
      notifyEmailDelivery: vi.fn(() => Promise.resolve()),
      notifyLinkedinPosted: vi.fn(() => Promise.resolve()),
      notifyTwitterPosted: vi.fn(() => Promise.resolve()),
    },
    sendPacer: { acquire: vi.fn(() => Promise.resolve()) },
    ...overrides,
  };
}

function makeSlackNotifier(overrides: Partial<NonNullable<EmailSendDeps["slackNotifier"]>> = {}): NonNullable<EmailSendDeps["slackNotifier"]> {
  return {
    notifyNewsletterSent: vi.fn(() => Promise.resolve()),
    notifyReviewPending: vi.fn(() => Promise.resolve()),
    notifyReviewWarning: vi.fn(() => Promise.resolve()),
    notifyPublishFailed: vi.fn(() => Promise.resolve()),
    notifyPublishUnavailable: vi.fn(() => Promise.resolve()),
    notifySourceDistribution: vi.fn(() => Promise.resolve()),
    notifyEmailDelivery: vi.fn(() => Promise.resolve()),
    notifyLinkedinPosted: vi.fn(() => Promise.resolve()),
    notifyTwitterPosted: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// P14: sending-domain broadcast gate (REQ-053 / EDGE-005 / EDGE-006, REQ-052)
// ─────────────────────────────────────────────────────────────────────────────
describe("sending-domain broadcast gate (P14)", () => {
  function makeTenantsRepo(status: "pending" | "verified" | "failed" | null): {
    getSendingDomainStatus: ReturnType<typeof vi.fn>;
  } {
    return { getSendingDomainStatus: vi.fn(() => Promise.resolve(status)) };
  }

  it.each([
    ["pending", "pending" as const],
    ["failed", "failed" as const],
    ["absent (never registered)", null],
  ])(
    "test_REQ_053_broadcast_blocked_without_domain_transactional_ok — %s domain blocks the broadcast but the targeted (welcome/transactional) send still goes out",
    async (_label, status) => {
      const archive = makeArchive();
      const tenantsRepo = makeTenantsRepo(status);
      const slackNotifier = makeSlackNotifier();
      const deps = makeDeps(archive, { tenantsRepo, slackNotifier });

      // Broadcast: BLOCKED with a clear status, no archive marker stamped.
      await handleEmailSendJob(deps, { name: "email-send", id: "job-1", data: {} });
      expect(deps.emailProvider.send).not.toHaveBeenCalled();
      expect(deps.archiveRepo.markEmailSent).not.toHaveBeenCalled();
      expect(slackNotifier.notifyPublishFailed).toHaveBeenCalledWith({
        runId: archive.id,
        channel: "email-send",
        reason: "sending_domain_not_verified",
      });

      // Targeted send (EDGE-005 counterpart): goes out via the shared
      // platform sender (deps.fromMail) regardless of domain status.
      await handleEmailSendJob(deps, {
        name: "email-send",
        id: "job-2",
        data: { runId: archive.id, subscriberIds: ["sub-1"] },
      });
      expect(deps.emailProvider.send).toHaveBeenCalledOnce();
      expect(deps.emailProvider.send).toHaveBeenCalledWith(
        expect.objectContaining({ from: deps.fromMail }),
      );
      expect(deps.archiveRepo.markEmailSent).not.toHaveBeenCalled();
    },
  );

  it("allows the broadcast when the tenant sending domain is verified — and proves the gate path actually ran", async () => {
    const archive = makeArchive();
    const tenantsRepo = makeTenantsRepo("verified");
    const deps = makeDeps(archive, { tenantsRepo });

    await handleEmailSendJob(deps, { name: "email-send", id: "job-1", data: {} });

    // The gate is consulted on EVERY broadcast (fail-closed design): a
    // verified status is the only thing that lets the send proceed.
    expect(tenantsRepo.getSendingDomainStatus).toHaveBeenCalledOnce();
    expect(deps.emailProvider.send).toHaveBeenCalledOnce();
    expect(deps.archiveRepo.markEmailSent).toHaveBeenCalledOnce();
  });

  // SECURITY (fail-closed): `tenantsRepo` is REQUIRED on EmailSendDeps, so a
  // typed caller cannot omit it (compile-time guarantee). This test simulates
  // the only remaining bypass vector — an untyped/JS caller omitting the repo
  // at runtime — and proves the broadcast still cannot go out unchecked: the
  // job fails before any email is sent and the archive marker stays unset.
  it("test_REQ_053_fail_closed_gate_omission — omitting tenantsRepo can no longer bypass the gate: the broadcast never sends", async () => {
    const archive = makeArchive();
    const base = makeDeps(archive);
    const depsWithoutRepo = { ...base, tenantsRepo: undefined };

    await expect(
      handleEmailSendJob(depsWithoutRepo as never, {
        name: "email-send",
        id: "job-1",
        data: {},
      }),
    ).rejects.toThrow();

    expect(base.emailProvider.send).not.toHaveBeenCalled();
    expect(base.archiveRepo.markEmailSent).not.toHaveBeenCalled();
  });

  it("test_EDGE_006_publish_without_domain_blocks_broadcast_allows_social — social publish proceeds while the email broadcast is blocked", async () => {
    const archive = makeArchive();
    const deps = makeDeps(archive, { tenantsRepo: makeTenantsRepo("pending") });

    await handleEmailSendJob(deps, { name: "email-send", id: "job-1", data: {} });
    expect(deps.emailProvider.send).not.toHaveBeenCalled();

    // LinkedIn publish of the SAME archive is untouched by the domain gate.
    const linkedinNotifier = {
      notifyArchiveReady: vi.fn(() => Promise.resolve({ status: "posted" as const })),
    };
    await handleLinkedInPostJob(
      {
        archiveRepo: deps.archiveRepo,
        linkedinNotifier,
        slackNotifier: deps.slackNotifier,
      },
      { name: "linkedin-post", id: "job-2", data: { runId: archive.id } },
    );
    expect(linkedinNotifier.notifyArchiveReady).toHaveBeenCalledWith({
      runId: archive.id,
    });
  });

  it("test_REQ_052_broadcast_only_confirmed_of_tenant — a verified broadcast resolves recipients via the tenant-scoped listConfirmed, never findByIds", async () => {
    const archive = makeArchive();
    const confirmed = [
      makeSubscriber({ id: "sub-1", email: "a@example.com" }),
      makeSubscriber({ id: "sub-2", email: "b@example.com" }),
    ];
    const deps = makeDeps(archive, {
      tenantsRepo: makeTenantsRepo("verified"),
      subscribersRepo: {
        listConfirmed: vi.fn(() => Promise.resolve(confirmed)),
        findByIds: vi.fn(() => Promise.resolve([])),
      },
    });

    await handleEmailSendJob(deps, { name: "email-send", id: "job-1", data: {} });

    expect(deps.subscribersRepo.listConfirmed).toHaveBeenCalledOnce();
    expect(deps.subscribersRepo.findByIds).not.toHaveBeenCalled();
    expect(deps.emailProvider.send).toHaveBeenCalledTimes(2);
    const sentTo = (deps.emailProvider.send as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => (call[0] as { to: string[] }).to)
      .flat()
      .sort();
    expect(sentTo).toEqual(["a@example.com", "b@example.com"]);
  });
});

describe("handleEmailSendJob", () => {
  it("scheduled jobs publish the latest reviewed unsent archive", async () => {
    const archive = makeArchive();
    const deps = makeDeps(archive);

    await handleEmailSendJob(deps, { name: "email-send", id: "job-1", data: {} });

    expect(deps.archiveRepo.findLatestTerminal).toHaveBeenCalledOnce();
    expect(deps.archiveRepo.findById).not.toHaveBeenCalled();
    expect(deps.emailProvider.send).toHaveBeenCalledOnce();
    expect(deps.archiveRepo.markEmailSent).toHaveBeenCalledWith(
      archive.id,
      expect.any(Date),
    );
  });

  it("scheduled jobs send a Slack error when the latest archive is unreviewed", async () => {
    const archive = makeArchive({ reviewed: false });
    const deps = makeDeps(archive);

    await handleEmailSendJob(deps, { name: "email-send", id: "job-1", data: {} });

    expect(deps.emailProvider.send).not.toHaveBeenCalled();
    expect(deps.slackNotifier?.notifyPublishUnavailable).toHaveBeenCalledWith({
      channel: "email-send",
      reason: "latest_unreviewed",
      runId: archive.id,
    });
  });

  it("scheduled jobs send a Slack error when the latest archive failed", async () => {
    const archive = makeArchive({ status: "failed", reviewed: false });
    const deps = makeDeps(archive);

    await handleEmailSendJob(deps, { name: "email-send", id: "job-1", data: {} });

    expect(deps.emailProvider.send).not.toHaveBeenCalled();
    expect(deps.slackNotifier?.notifyPublishUnavailable).toHaveBeenCalledWith({
      channel: "email-send",
      reason: "latest_failed",
      runId: archive.id,
    });
  });

  it("scheduled jobs no-op when the latest archive was already emailed", async () => {
    const archive = makeArchive({ emailSentAt: new Date("2026-05-18T10:00:00.000Z") });
    const deps = makeDeps(archive);

    await handleEmailSendJob(deps, { name: "email-send", id: "job-1", data: {} });

    expect(deps.emailProvider.send).not.toHaveBeenCalled();
    expect(deps.slackNotifier?.notifyPublishUnavailable).not.toHaveBeenCalled();
  });

  it("targeted welcome send to a new subscriber does NOT stamp emailSentAt (would poison the broadcast guard)", async () => {
    const archive = makeArchive({ id: "00000000-0000-0000-0000-000000000123" });
    const newSubscriber = makeSubscriber({ id: "new-sub", email: "new@example.com" });
    const deps = makeDeps(null, {
      archiveRepo: {
        ...makeDeps(null).archiveRepo,
        findById: vi.fn(() => Promise.resolve(archive)),
        findLatestTerminal: vi.fn(() => Promise.resolve(null)),
      },
      subscribersRepo: {
        listConfirmed: vi.fn(() => Promise.resolve([makeSubscriber()])),
        findByIds: vi.fn(() => Promise.resolve([newSubscriber])),
      },
    });

    await handleEmailSendJob(deps, {
      name: "email-send",
      id: "welcome-job",
      data: { runId: archive.id, subscriberIds: ["new-sub"] },
    });

    expect(deps.subscribersRepo.findByIds).toHaveBeenCalledWith(["new-sub"]);
    expect(deps.emailProvider.send).toHaveBeenCalledOnce();
    // The targeted send delivers the issue but must NOT touch the archive marker
    // or fire the digest-level "newsletter emailed" Slack summary.
    expect(deps.archiveRepo.markEmailSent).not.toHaveBeenCalled();
    expect(deps.slackNotifier?.notifyEmailDelivery).not.toHaveBeenCalled();
  });

  it("targeted welcome send still delivers even after the broadcast has emailSentAt set", async () => {
    const archive = makeArchive({
      id: "00000000-0000-0000-0000-000000000123",
      emailSentAt: new Date("2026-05-18T10:00:00.000Z"),
    });
    const newSubscriber = makeSubscriber({ id: "late-sub", email: "late@example.com" });
    const deps = makeDeps(null, {
      archiveRepo: {
        ...makeDeps(null).archiveRepo,
        findById: vi.fn(() => Promise.resolve(archive)),
        findLatestTerminal: vi.fn(() => Promise.resolve(null)),
      },
      subscribersRepo: {
        listConfirmed: vi.fn(() => Promise.resolve([makeSubscriber()])),
        findByIds: vi.fn(() => Promise.resolve([newSubscriber])),
      },
    });

    await handleEmailSendJob(deps, {
      name: "email-send",
      id: "welcome-job",
      data: { runId: archive.id, subscriberIds: ["late-sub"] },
    });

    // The broadcast guard must NOT block a targeted welcome send.
    expect(deps.emailProvider.send).toHaveBeenCalledOnce();
    expect(deps.archiveRepo.markEmailSent).not.toHaveBeenCalled();
  });

  // VS-9 — regression guard for Part 1 fix (commit 60d748b)
  it("targeted welcome send does NOT fire notifyEmailDelivery (regression guard for broadcast Slack poisoning)", async () => {
    const archive = makeArchive({ id: "00000000-0000-0000-0000-000000000456" });
    const newSubscriber = makeSubscriber({ id: "vs9-sub", email: "vs9@example.com" });
    const notifyEmailDelivery = vi.fn(() => Promise.resolve());
    const deps = makeDeps(null, {
      archiveRepo: {
        ...makeDeps(null).archiveRepo,
        findById: vi.fn(() => Promise.resolve(archive)),
        findLatestTerminal: vi.fn(() => Promise.resolve(null)),
      },
      subscribersRepo: {
        listConfirmed: vi.fn(() => Promise.resolve([makeSubscriber()])),
        findByIds: vi.fn(() => Promise.resolve([newSubscriber])),
      },
      slackNotifier: {
        notifyNewsletterSent: vi.fn(() => Promise.resolve()),
        notifyReviewPending: vi.fn(() => Promise.resolve()),
        notifyReviewWarning: vi.fn(() => Promise.resolve()),
        notifyPublishFailed: vi.fn(() => Promise.resolve()),
        notifyPublishUnavailable: vi.fn(() => Promise.resolve()),
        notifySourceDistribution: vi.fn(() => Promise.resolve()),
        notifyEmailDelivery,
        notifyLinkedinPosted: vi.fn(() => Promise.resolve()),
        notifyTwitterPosted: vi.fn(() => Promise.resolve()),
      },
    });

    await handleEmailSendJob(deps, {
      name: "email-send",
      id: "vs9-job",
      data: { runId: archive.id, subscriberIds: ["vs9-sub"] },
    });

    // The targeted send delivers the issue to the subscriber
    expect(deps.emailProvider.send).toHaveBeenCalledOnce();
    // REGRESSION GUARD: targeted send must never fire the broadcast-level Slack summary
    expect(notifyEmailDelivery).not.toHaveBeenCalled();
    // REGRESSION GUARD: targeted send must never stamp the archive marker
    expect(deps.archiveRepo.markEmailSent).not.toHaveBeenCalled();
  });

  it("broadcast IS blocked when emailSentAt is already set by a prior broadcast", async () => {
    const archive = makeArchive({
      id: "00000000-0000-0000-0000-000000000123",
      emailSentAt: new Date("2026-05-18T10:00:00.000Z"),
    });
    const deps = makeDeps(null, {
      archiveRepo: {
        ...makeDeps(null).archiveRepo,
        findById: vi.fn(() => Promise.resolve(archive)),
        findLatestTerminal: vi.fn(() => Promise.resolve(null)),
      },
    });

    await handleEmailSendJob(deps, {
      name: "email-send",
      id: "broadcast-job",
      data: { runId: archive.id, subscriberIds: "all" },
    });

    expect(deps.emailProvider.send).not.toHaveBeenCalled();
    expect(deps.archiveRepo.markEmailSent).not.toHaveBeenCalled();
  });

  it("explicit runId jobs keep exact-archive behavior", async () => {
    const archive = makeArchive({ id: "00000000-0000-0000-0000-000000000123" });
    const deps = makeDeps(null, {
      archiveRepo: {
        ...makeDeps(null).archiveRepo,
        findById: vi.fn(() => Promise.resolve(archive)),
        findLatestTerminal: vi.fn(() => Promise.resolve(null)),
      },
    });

    await handleEmailSendJob(deps, {
      name: "email-send",
      id: "job-1",
      data: { runId: archive.id, subscriberIds: "all" },
    });

    expect(deps.archiveRepo.findById).toHaveBeenCalledWith(archive.id);
    expect(deps.archiveRepo.findLatestTerminal).not.toHaveBeenCalled();
    expect(deps.emailProvider.send).toHaveBeenCalledOnce();
  });

  // VS-4 / REQ-004: notifyEmailDelivery called with correct counts
  it("VS-4: calls notifyEmailDelivery with correct delivery counts after send", async () => {
    const archive = makeArchive();
    const notifyEmailDelivery = vi.fn(() => Promise.resolve());
    const deps = makeDeps(archive, {
      slackNotifier: {
        notifyNewsletterSent: vi.fn(() => Promise.resolve()),
        notifyReviewPending: vi.fn(() => Promise.resolve()),
        notifyReviewWarning: vi.fn(() => Promise.resolve()),
        notifyPublishFailed: vi.fn(() => Promise.resolve()),
        notifyPublishUnavailable: vi.fn(() => Promise.resolve()),
        notifySourceDistribution: vi.fn(() => Promise.resolve()),
        notifyEmailDelivery,
        notifyLinkedinPosted: vi.fn(() => Promise.resolve()),
        notifyTwitterPosted: vi.fn(() => Promise.resolve()),
      },
    });

    await handleEmailSendJob(deps, { name: "email-send", id: "job-1", data: {} });

    expect(notifyEmailDelivery).toHaveBeenCalledOnce();
    expect(notifyEmailDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: archive.id,
        delivery: expect.objectContaining({
          attempted: 1,
          sent: 1,
          failed: 0,
        }),
      }),
    );
  });

  // VS-5 / REQ-005: notifyNewsletterSent NOT called from email-send
  it("VS-5: does not call notifyNewsletterSent from email-send worker", async () => {
    const archive = makeArchive();
    const notifyNewsletterSent = vi.fn(() => Promise.resolve());
    const deps = makeDeps(archive, {
      slackNotifier: {
        notifyNewsletterSent,
        notifyReviewPending: vi.fn(() => Promise.resolve()),
        notifyReviewWarning: vi.fn(() => Promise.resolve()),
        notifyPublishFailed: vi.fn(() => Promise.resolve()),
        notifyPublishUnavailable: vi.fn(() => Promise.resolve()),
        notifySourceDistribution: vi.fn(() => Promise.resolve()),
        notifyEmailDelivery: vi.fn(() => Promise.resolve()),
        notifyLinkedinPosted: vi.fn(() => Promise.resolve()),
        notifyTwitterPosted: vi.fn(() => Promise.resolve()),
      },
    });

    await handleEmailSendJob(deps, { name: "email-send", id: "job-1", data: {} });

    expect(notifyNewsletterSent).not.toHaveBeenCalled();
  });
});

// ─── Phase 2: Rate resolution ─────────────────────────────────────────────────

describe("resolveSendRate (REQ-003/004/005)", () => {
  it("returns 3 when env is empty", () => {
    expect(resolveSendRate({})).toBe(3);
  });

  it("returns 2 when EMAIL_SEND_RATE_PER_SECOND=2", () => {
    expect(resolveSendRate({ EMAIL_SEND_RATE_PER_SECOND: "2" })).toBe(2);
  });

  it("returns 3 when EMAIL_SEND_RATE_PER_SECOND is empty string", () => {
    expect(resolveSendRate({ EMAIL_SEND_RATE_PER_SECOND: "" })).toBe(3);
  });

  it("returns 3 when EMAIL_SEND_RATE_PER_SECOND is non-numeric", () => {
    expect(resolveSendRate({ EMAIL_SEND_RATE_PER_SECOND: "abc" })).toBe(3);
  });

  it("returns 3 when EMAIL_SEND_RATE_PER_SECOND is zero", () => {
    expect(resolveSendRate({ EMAIL_SEND_RATE_PER_SECOND: "0" })).toBe(3);
  });

  it("returns 3 when EMAIL_SEND_RATE_PER_SECOND is negative", () => {
    expect(resolveSendRate({ EMAIL_SEND_RATE_PER_SECOND: "-1" })).toBe(3);
  });

  it("returns 3 when EMAIL_SEND_RATE_PER_SECOND is a float string", () => {
    expect(resolveSendRate({ EMAIL_SEND_RATE_PER_SECOND: "2.5" })).toBe(3);
  });

  it("honors large valid values (EDGE-008)", () => {
    expect(resolveSendRate({ EMAIL_SEND_RATE_PER_SECOND: "50" })).toBe(50);
  });
});

// ─── Phase 2: Shared pacer (REQ-002 / EDGE-001) ──────────────────────────────

describe("getSharedPacer (REQ-002)", () => {
  beforeEach(() => {
    resetSharedPacerForTests();
  });

  it("returns the same instance on repeated calls", () => {
    const p1 = getSharedPacer();
    const p2 = getSharedPacer();
    expect(p1).toBe(p2);
  });
});

// ─── Phase 2: Per-recipient retry ────────────────────────────────────────────

describe("handleEmailSendJob — per-recipient retry", () => {
  beforeEach(() => {
    resetSharedPacerForTests();
    vi.clearAllMocks();
  });

  function makeSleepSpy(): (ms: number) => Promise<void> {
    const spy = vi.fn((_ms: number) => Promise.resolve());
    return spy as (ms: number) => Promise<void>;
  }

  // REQ-006: retryable error once then resolves → sent, send called 2×, one email_sends row
  it("REQ-006: retries once on retryable error then succeeds", async () => {
    const archive = makeArchive();
    const sleepSpy = makeSleepSpy();
    const retryableErr = new EmailSendError({
      code: "rate_limit_exceeded",
      message: "Too many requests",
      retryAfterMs: null,
      retryable: true,
    });
    const sendSpy = vi.fn()
      .mockRejectedValueOnce(retryableErr)
      .mockResolvedValueOnce({ messageId: "msg-ok" });

    const deps = makeDeps(archive, {
      emailProvider: { send: sendSpy },
      sleep: sleepSpy,
    });

    await handleEmailSendJob(deps, { name: "email-send", id: "job-1", data: {} });

    expect(sendSpy).toHaveBeenCalledTimes(2);
    expect(deps.emailSendsRepo.create).toHaveBeenCalledOnce();
    // sleep called once between attempts
    expect(sleepSpy).toHaveBeenCalledOnce();
  });

  // REQ-007: retryAfterMs=1500 → sleep called with 1500
  it("REQ-007: honors retryAfterMs when set", async () => {
    const archive = makeArchive();
    const sleepSpy = makeSleepSpy();
    const retryableErr = new EmailSendError({
      code: "rate_limit_exceeded",
      message: "Too many requests",
      retryAfterMs: 1500,
      retryable: true,
    });
    const sendSpy = vi.fn()
      .mockRejectedValueOnce(retryableErr)
      .mockResolvedValueOnce({ messageId: "msg-ok" });

    const deps = makeDeps(archive, {
      emailProvider: { send: sendSpy },
      sleep: sleepSpy,
    });

    await handleEmailSendJob(deps, { name: "email-send", id: "job-1", data: {} });

    expect(sleepSpy).toHaveBeenCalledWith(1500);
  });

  // REQ-008: no retryAfter → exponential backoff, attempt 1 → 1000 ms
  it("REQ-008: uses exponential backoff (1000ms) when no retryAfterMs", async () => {
    const archive = makeArchive();
    const sleepSpy = makeSleepSpy();
    const retryableErr = new EmailSendError({
      code: "application_error",
      message: "Application error",
      retryAfterMs: null,
      retryable: true,
    });
    const sendSpy = vi.fn()
      .mockRejectedValueOnce(retryableErr)
      .mockResolvedValueOnce({ messageId: "msg-ok" });

    const deps = makeDeps(archive, {
      emailProvider: { send: sendSpy },
      sleep: sleepSpy,
    });

    await handleEmailSendJob(deps, { name: "email-send", id: "job-1", data: {} });

    expect(sleepSpy).toHaveBeenCalledWith(1000);
  });

  // REQ-009: non-retryable error → send called once, recipient failed
  it("REQ-009: does not retry non-retryable errors", async () => {
    const archive = makeArchive();
    const sleepSpy = makeSleepSpy();
    const nonRetryableErr = new EmailSendError({
      code: "validation_error",
      message: "Invalid address",
      retryAfterMs: null,
      retryable: false,
    });
    const sendSpy = vi.fn().mockRejectedValue(nonRetryableErr);

    const notifyEmailDelivery = vi.fn(() => Promise.resolve());
    const deps = makeDeps(archive, {
      emailProvider: { send: sendSpy },
      sleep: sleepSpy,
      slackNotifier: makeSlackNotifier({ notifyEmailDelivery }),
    });

    await handleEmailSendJob(deps, { name: "email-send", id: "job-1", data: {} });

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sleepSpy).not.toHaveBeenCalled();
    expect(notifyEmailDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery: expect.objectContaining({ failed: 1, sent: 0 }),
      }),
    );
  });

  // REQ-010: acquire() called once per send attempt
  it("REQ-010: re-acquires pacer on retry", async () => {
    const archive = makeArchive();
    const sleepSpy = makeSleepSpy();
    const retryableErr = new EmailSendError({
      code: "rate_limit_exceeded",
      message: "Too many requests",
      retryAfterMs: null,
      retryable: true,
    });
    const sendSpy = vi.fn()
      .mockRejectedValueOnce(retryableErr)
      .mockResolvedValueOnce({ messageId: "msg-ok" });

    const acquireSpy = vi.fn(() => Promise.resolve());
    const deps = makeDeps(archive, {
      emailProvider: { send: sendSpy },
      sleep: sleepSpy,
      sendPacer: { acquire: acquireSpy },
    });

    await handleEmailSendJob(deps, { name: "email-send", id: "job-1", data: {} });

    // 2 send attempts → 2 pacer acquisitions
    expect(acquireSpy).toHaveBeenCalledTimes(2);
  });

  // REQ-011 / EDGE-005: always-throwing retryable → failed counted once, reason in summary
  it("REQ-011/EDGE-005: failed counted once when all retries exhausted", async () => {
    const archive = makeArchive();
    const sleepSpy = makeSleepSpy();
    const retryableErr = new EmailSendError({
      code: "rate_limit_exceeded",
      message: "Too many requests",
      retryAfterMs: null,
      retryable: true,
    });
    const sendSpy = vi.fn().mockRejectedValue(retryableErr);

    const notifyEmailDelivery = vi.fn(() => Promise.resolve());
    const deps = makeDeps(archive, {
      emailProvider: { send: sendSpy },
      sleep: sleepSpy,
      slackNotifier: makeSlackNotifier({ notifyEmailDelivery }),
    });

    await handleEmailSendJob(deps, { name: "email-send", id: "job-1", data: {} });

    // Exactly 2 send attempts (max), not 3
    expect(sendSpy).toHaveBeenCalledTimes(2);
    // Failed counted exactly once
    expect(notifyEmailDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery: expect.objectContaining({ failed: 1, sent: 0 }),
      }),
    );
    // failure reason is present
    const call = (notifyEmailDelivery.mock.calls[0] as [{ delivery: { failureReasons?: { reason: string; count: number }[] } }])[0];
    expect(call.delivery.failureReasons).toBeDefined();
    expect((call.delivery.failureReasons ?? []).length).toBeGreaterThan(0);
  });

  // EDGE-007: retry-then-succeed creates exactly one email_sends row
  it("EDGE-007: retry-then-succeed creates exactly one email_sends row", async () => {
    const archive = makeArchive();
    const sleepSpy = makeSleepSpy();
    const retryableErr = new EmailSendError({
      code: "rate_limit_exceeded",
      message: "Too many requests",
      retryAfterMs: null,
      retryable: true,
    });
    const sendSpy = vi.fn()
      .mockRejectedValueOnce(retryableErr)
      .mockResolvedValueOnce({ messageId: "msg-ok" });

    const deps = makeDeps(archive, {
      emailProvider: { send: sendSpy },
      sleep: sleepSpy,
    });

    await handleEmailSendJob(deps, { name: "email-send", id: "job-1", data: {} });

    expect(deps.emailSendsRepo.create).toHaveBeenCalledTimes(1);
  });

  // A plain (non-EmailSendError) network/timeout throw is matched by the
  // worker's untyped retry heuristic (timeout/ETIMEDOUT/ECONNRESET) — this is
  // the SES/fetch path that the EmailSendError-based retry tests never cover.
  // It must retry once, succeed, create exactly one email_sends row, and honor
  // the 2-attempt cap.
  it("retries a plain network Error('connect ETIMEDOUT') once then succeeds (2-attempt cap)", async () => {
    const archive = makeArchive();
    const sleepSpy = makeSleepSpy();
    const sendSpy = vi.fn()
      .mockRejectedValueOnce(new Error("connect ETIMEDOUT 1.2.3.4:443"))
      .mockResolvedValueOnce({ messageId: "msg-ok" });

    const notifyEmailDelivery = vi.fn(() => Promise.resolve());
    const deps = makeDeps(archive, {
      emailProvider: { send: sendSpy },
      sleep: sleepSpy,
      slackNotifier: makeSlackNotifier({ notifyEmailDelivery }),
    });

    await handleEmailSendJob(deps, { name: "email-send", id: "job-1", data: {} });

    // Exactly 2 attempts (one retry), capped at 2 — not 3.
    expect(sendSpy).toHaveBeenCalledTimes(2);
    expect(sleepSpy).toHaveBeenCalledOnce();
    // The retry-then-success creates exactly one email_sends row.
    expect(deps.emailSendsRepo.create).toHaveBeenCalledTimes(1);
    // Delivery summary reflects the eventual success.
    expect(notifyEmailDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery: expect.objectContaining({ attempted: 1, sent: 1, failed: 0 }),
      }),
    );
  });

  // Companion boundary: a plain Error whose message does NOT match the
  // network/timeout heuristic (e.g. a generic SES rejection) is NOT retried —
  // send is called exactly once and the recipient is counted failed.
  it("does NOT retry a plain non-network Error('SES error') — single attempt, counted failed", async () => {
    const archive = makeArchive();
    const sleepSpy = makeSleepSpy();
    const sendSpy = vi.fn().mockRejectedValue(new Error("SES error"));

    const notifyEmailDelivery = vi.fn(() => Promise.resolve());
    const deps = makeDeps(archive, {
      emailProvider: { send: sendSpy },
      sleep: sleepSpy,
      slackNotifier: makeSlackNotifier({ notifyEmailDelivery }),
    });

    await handleEmailSendJob(deps, { name: "email-send", id: "job-1", data: {} });

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sleepSpy).not.toHaveBeenCalled();
    expect(notifyEmailDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery: expect.objectContaining({ failed: 1, sent: 0 }),
      }),
    );
  });

  // REQ-002/EDGE-001: shared pacer persists across two sequential jobs
  it("REQ-002/EDGE-001: shared pacer is the same instance across two job runs", async () => {
    resetSharedPacerForTests();

    const archive1 = makeArchive({ id: "00000000-0000-0000-0000-000000000001" });
    const archive2 = makeArchive({ id: "00000000-0000-0000-0000-000000000002" });

    const acquireSpy = vi.fn(() => Promise.resolve());
    const sharedPacerInstance = { acquire: acquireSpy };

    // First job
    const deps1 = makeDeps(archive1, { sendPacer: sharedPacerInstance });
    await handleEmailSendJob(deps1, { name: "email-send", id: "job-1", data: {} });

    // Second job with same pacer instance
    const deps2 = makeDeps(archive2, {
      sendPacer: sharedPacerInstance,
      archiveRepo: {
        ...makeDeps(archive2).archiveRepo,
        findLatestTerminal: vi.fn(() => Promise.resolve(archive2)),
        findById: vi.fn(() => Promise.resolve(archive2)),
        markEmailSent: vi.fn(() => Promise.resolve()),
      },
    });
    await handleEmailSendJob(deps2, { name: "email-send", id: "job-2", data: {} });

    // Acquire called once per job (one subscriber each)
    expect(acquireSpy).toHaveBeenCalledTimes(2);
  });
});

// ─── createSendPacer fixed-interval pacing proof ─────────────────────────────

describe("createSendPacer (fixed-interval pacing)", () => {
  it("paces acquisitions so no 1-sec window exceeds the rate and successive sends are >= 200ms apart", async () => {
    let virtualNow = 1_000_000;
    const fakeNow = (): number => virtualNow;
    const fakeSleep = (ms: number): Promise<void> => {
      virtualNow += ms;
      return Promise.resolve();
    };

    const pacer = createSendPacer(5, { now: fakeNow, sleep: fakeSleep });

    const sendTimestamps: number[] = [];
    // 12 serialized acquisitions; record the virtual clock at each grant.
    for (let i = 0; i < 12; i += 1) {
      await pacer.acquire();
      sendTimestamps.push(virtualNow);
    }

    // Sliding-window guarantee: no rolling 1000ms contains more than 5 sends.
    for (const t of sendTimestamps) {
      const within = sendTimestamps.filter((s) => s <= t && t - s < 1000).length;
      expect(within).toBeLessThanOrEqual(5);
    }
    // Stronger guarantee from fixed-interval pacing: successive sends are
    // spaced by at least ceil(1000 / 5) = 200 ms. This is what prevents the
    // provider from seeing a burst at the window boundary.
    for (let i = 1; i < sendTimestamps.length; i += 1) {
      const gap = sendTimestamps[i] - sendTimestamps[i - 1];
      expect(gap).toBeGreaterThanOrEqual(200);
    }
  });
});
