import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SubscriberSelect } from "@newsletter/shared";
import type { NewsletterSendDeps, NewsletterRenderProps } from "@pipeline/workers/newsletter-send.js";
import type { PipelineRunArchiveRow } from "@pipeline/repositories/run-archives.js";

const mockLoggerInfo = vi.fn();
const mockLoggerWarn = vi.fn();
const mockLoggerError = vi.fn();

vi.mock("@newsletter/shared/logger", () => ({
  createLogger: vi.fn(() => ({
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
  })),
}));

const { handleNewsletterSendJob } = await import(
  "@pipeline/workers/newsletter-send.js"
);

function makeSubscriber(overrides: Partial<SubscriberSelect> = {}): SubscriberSelect {
  return {
    id: "sub-1",
    email: "test@example.com",
    status: "confirmed",
    confirmToken: null,
    confirmTokenExpiresAt: null,
    subscribedAt: new Date("2026-01-01"),
    unsubscribedAt: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function makeArchive(overrides: Partial<PipelineRunArchiveRow> = {}): PipelineRunArchiveRow {
  return {
    id: "run-uuid-1234",
    status: "completed",
    rankedItems: [
      { rawItemId: 1, score: 0.9, rationale: "good" },
    ],
    topN: 5,
    reviewed: true,
    completedAt: new Date("2026-05-01"),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<NewsletterSendDeps> = {}): NewsletterSendDeps {
  return {
    emailProvider: {
      send: vi.fn().mockResolvedValue({ messageId: "msg-123" }),
    },
    subscribersRepo: {
      listConfirmed: vi.fn().mockResolvedValue([]),
      findByIds: vi.fn().mockResolvedValue([]),
    },
    emailSendsRepo: {
      create: vi.fn().mockResolvedValue({ id: "send-1" }),
      findSentSubscriberIds: vi.fn().mockResolvedValue(new Set()),
    },
    archiveRepo: {
      findById: vi.fn().mockResolvedValue(makeArchive()),
      upsert: vi.fn().mockResolvedValue(undefined),
    },
    rawItemsRepo: {
      upsertItems: vi.fn(),
      findExistingExternalIds: vi.fn().mockResolvedValue(new Set()),
      findBySourceAndExternalId: vi.fn().mockResolvedValue(null),
      findByIds: vi.fn().mockResolvedValue([
        {
          id: 1,
          sourceType: "hn",
          externalId: "ext-1",
          title: "Test Story",
          url: "https://example.com/story",
          sourceUrl: null,
          author: null,
          content: null,
          imageUrl: null,
          publishedAt: null,
          engagement: { points: 10, commentCount: 5 },
          metadata: { comments: [] },
        },
      ]),
      updateRecapData: vi.fn(),
    },
    renderNewsletter: vi.fn().mockResolvedValue("<html>newsletter</html>"),
    sessionSecret: "test-secret",
    sesFromEmail: "newsletter@example.com",
    replyToEmail: undefined,
    baseUrl: "https://example.com",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleNewsletterSendJob", () => {
  it("noops when job.name is not 'send-newsletter'", async () => {
    const deps = makeDeps();
    await handleNewsletterSendJob(deps, { name: "daily-run", id: "j1", data: { runId: "r1", subscriberIds: "all" } });
    expect(deps.archiveRepo.findById).not.toHaveBeenCalled();
  });

  it("warns and returns when archive not found", async () => {
    const deps = makeDeps({
      archiveRepo: {
        findById: vi.fn().mockResolvedValue(null),
        upsert: vi.fn(),
      },
    });
    await handleNewsletterSendJob(deps, {
      name: "send-newsletter",
      id: "j1",
      data: { runId: "nonexistent-id-0000-0000-000000000000", subscriberIds: "all" },
    });
    expect(mockLoggerWarn).toHaveBeenCalled();
    expect(deps.emailProvider.send).not.toHaveBeenCalled();
  });

  it("returns early with no sends when 0 confirmed subscribers", async () => {
    const deps = makeDeps({
      subscribersRepo: {
        listConfirmed: vi.fn().mockResolvedValue([]),
        findByIds: vi.fn().mockResolvedValue([]),
      },
    });
    await handleNewsletterSendJob(deps, {
      name: "send-newsletter",
      id: "j1",
      data: { runId: "run-uuid-1234", subscriberIds: "all" },
    });
    expect(deps.emailProvider.send).not.toHaveBeenCalled();
    expect(deps.emailSendsRepo.create).not.toHaveBeenCalled();
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ event: "newsletter-send.no-recipients" }),
      expect.any(String),
    );
  });

  it("skips already-sent subscribers (deduplication)", async () => {
    const sub = makeSubscriber();
    const deps = makeDeps({
      subscribersRepo: {
        listConfirmed: vi.fn().mockResolvedValue([sub]),
        findByIds: vi.fn().mockResolvedValue([sub]),
      },
      emailSendsRepo: {
        create: vi.fn(),
        findSentSubscriberIds: vi.fn().mockResolvedValue(new Set([sub.id])),
      },
    });
    await handleNewsletterSendJob(deps, {
      name: "send-newsletter",
      id: "j1",
      data: { runId: "run-uuid-1234", subscriberIds: "all" },
    });
    expect(deps.emailProvider.send).not.toHaveBeenCalled();
    expect(deps.emailSendsRepo.create).not.toHaveBeenCalled();
  });

  it("sends to 3 subscribers and creates 3 email_sends rows", async () => {
    const subs = [
      makeSubscriber({ id: "sub-1", email: "a@x.com" }),
      makeSubscriber({ id: "sub-2", email: "b@x.com" }),
      makeSubscriber({ id: "sub-3", email: "c@x.com" }),
    ];
    const sendMock = vi.fn()
      .mockResolvedValueOnce({ messageId: "msg-1" })
      .mockResolvedValueOnce({ messageId: "msg-2" })
      .mockResolvedValueOnce({ messageId: "msg-3" });
    const createMock = vi.fn().mockResolvedValue({ id: "send-row" });

    const deps = makeDeps({
      emailProvider: { send: sendMock },
      subscribersRepo: {
        listConfirmed: vi.fn().mockResolvedValue(subs),
        findByIds: vi.fn().mockResolvedValue(subs),
      },
      emailSendsRepo: {
        create: createMock,
        findSentSubscriberIds: vi.fn().mockResolvedValue(new Set()),
      },
    });

    await handleNewsletterSendJob(deps, {
      name: "send-newsletter",
      id: "j1",
      data: { runId: "run-uuid-1234", subscriberIds: "all" },
    });

    expect(sendMock).toHaveBeenCalledTimes(3);
    expect(createMock).toHaveBeenCalledTimes(3);
  });

  it("creates email_sends rows with correct fields", async () => {
    const sub = makeSubscriber({ id: "sub-999", email: "z@x.com" });
    const sendMock = vi.fn().mockResolvedValue({ messageId: "msg-xyz" });
    const createMock = vi.fn().mockResolvedValue({ id: "send-row" });

    const deps = makeDeps({
      emailProvider: { send: sendMock },
      subscribersRepo: {
        listConfirmed: vi.fn().mockResolvedValue([sub]),
        findByIds: vi.fn().mockResolvedValue([sub]),
      },
      emailSendsRepo: {
        create: createMock,
        findSentSubscriberIds: vi.fn().mockResolvedValue(new Set()),
      },
    });

    await handleNewsletterSendJob(deps, {
      name: "send-newsletter",
      id: "j1",
      data: { runId: "run-uuid-1234", subscriberIds: "all" },
    });

    expect(createMock).toHaveBeenCalledWith({
      subscriberId: "sub-999",
      runArchiveId: "run-uuid-1234",
      messageId: "msg-xyz",
    });
  });

  it("batches 60 subscribers into 2 batches (50 + 10) and sends all", async () => {
    const subs = Array.from({ length: 60 }, (_, i) =>
      makeSubscriber({ id: `sub-${i}`, email: `user${i}@x.com` }),
    );
    const sendMock = vi.fn().mockResolvedValue({ messageId: "msg" });
    const createMock = vi.fn().mockResolvedValue({ id: "row" });

    const deps = makeDeps({
      emailProvider: { send: sendMock },
      subscribersRepo: {
        listConfirmed: vi.fn().mockResolvedValue(subs),
        findByIds: vi.fn().mockResolvedValue(subs),
      },
      emailSendsRepo: {
        create: createMock,
        findSentSubscriberIds: vi.fn().mockResolvedValue(new Set()),
      },
    });

    await handleNewsletterSendJob(deps, {
      name: "send-newsletter",
      id: "j1",
      data: { runId: "run-uuid-1234", subscriberIds: "all" },
    });

    expect(sendMock).toHaveBeenCalledTimes(60);
    expect(createMock).toHaveBeenCalledTimes(60);
  });

  it("does not block other sends when email provider throws for one subscriber", async () => {
    const subs = [
      makeSubscriber({ id: "sub-1", email: "a@x.com" }),
      makeSubscriber({ id: "sub-2", email: "b@x.com" }),
      makeSubscriber({ id: "sub-3", email: "c@x.com" }),
    ];
    const sendMock = vi.fn()
      .mockResolvedValueOnce({ messageId: "msg-1" })
      .mockRejectedValueOnce(new Error("SES error"))
      .mockResolvedValueOnce({ messageId: "msg-3" });
    const createMock = vi.fn().mockResolvedValue({ id: "row" });

    const deps = makeDeps({
      emailProvider: { send: sendMock },
      subscribersRepo: {
        listConfirmed: vi.fn().mockResolvedValue(subs),
        findByIds: vi.fn().mockResolvedValue(subs),
      },
      emailSendsRepo: {
        create: createMock,
        findSentSubscriberIds: vi.fn().mockResolvedValue(new Set()),
      },
    });

    // Should not throw even though one send fails
    await expect(handleNewsletterSendJob(deps, {
      name: "send-newsletter",
      id: "j1",
      data: { runId: "run-uuid-1234", subscriberIds: "all" },
    })).resolves.toBeUndefined();

    // 3 sends attempted, 2 succeeded so 2 creates
    expect(sendMock).toHaveBeenCalledTimes(3);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("uses subscriberIds array when provided instead of all confirmed", async () => {
    const subs = [makeSubscriber({ id: "sub-targeted", email: "t@x.com" })];
    const findByIdsMock = vi.fn().mockResolvedValue(subs);
    const listConfirmedMock = vi.fn().mockResolvedValue([]);

    const deps = makeDeps({
      subscribersRepo: {
        listConfirmed: listConfirmedMock,
        findByIds: findByIdsMock,
      },
    });

    await handleNewsletterSendJob(deps, {
      name: "send-newsletter",
      id: "j1",
      data: { runId: "run-uuid-1234", subscriberIds: ["sub-targeted"] },
    });

    expect(findByIdsMock).toHaveBeenCalledWith(["sub-targeted"]);
    expect(listConfirmedMock).not.toHaveBeenCalled();
    expect(deps.emailProvider.send).toHaveBeenCalledTimes(1);
  });

  it("passes correct List-Unsubscribe headers to email provider", async () => {
    const sub = makeSubscriber();
    const sendMock = vi.fn().mockResolvedValue({ messageId: "msg-1" });

    const deps = makeDeps({
      emailProvider: { send: sendMock },
      subscribersRepo: {
        listConfirmed: vi.fn().mockResolvedValue([sub]),
        findByIds: vi.fn().mockResolvedValue([sub]),
      },
    });

    await handleNewsletterSendJob(deps, {
      name: "send-newsletter",
      id: "j1",
      data: { runId: "run-uuid-1234", subscriberIds: "all" },
    });

    const call = sendMock.mock.calls[0][0] as { headers?: Record<string, string> };
    expect(call.headers?.["List-Unsubscribe"]).toMatch(/^<https:\/\/example\.com\/api\/unsubscribe\?token=/);
    expect(call.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("calls renderNewsletter for each subscriber", async () => {
    const subs = [
      makeSubscriber({ id: "sub-1", email: "a@x.com" }),
      makeSubscriber({ id: "sub-2", email: "b@x.com" }),
    ];
    const renderMock = vi.fn().mockResolvedValue("<html>newsletter</html>");

    const deps = makeDeps({
      renderNewsletter: renderMock,
      subscribersRepo: {
        listConfirmed: vi.fn().mockResolvedValue(subs),
        findByIds: vi.fn().mockResolvedValue(subs),
      },
    });

    await handleNewsletterSendJob(deps, {
      name: "send-newsletter",
      id: "j1",
      data: { runId: "run-uuid-1234", subscriberIds: "all" },
    });

    expect(renderMock).toHaveBeenCalledTimes(2);
    const [firstCall] = renderMock.mock.calls as [NewsletterRenderProps][];
    expect(firstCall[0]).toMatchObject({
      baseUrl: "https://example.com",
    });
  });

  it("calls slackNotifier with classified failure reasons after a partial-failure send", async () => {
    const subs = [
      makeSubscriber({ id: "sub-1", email: "a@x.com" }),
      makeSubscriber({ id: "sub-2", email: "b@x.com" }),
      makeSubscriber({ id: "sub-3", email: "c@x.com" }),
      makeSubscriber({ id: "sub-4", email: "d@x.com" }),
    ];
    const sendMock = vi
      .fn()
      .mockResolvedValueOnce({ messageId: "msg-ok" })
      .mockRejectedValueOnce(
        new Error(
          "Resend error: Too many requests. You can only make 5 requests per second.",
        ),
      )
      .mockRejectedValueOnce(
        new Error(
          "Resend error: Too many requests. You can only make 5 requests per second.",
        ),
      )
      .mockRejectedValueOnce(
        new Error(
          "Resend error: The example.com domain is not verified. Please verify it.",
        ),
      );
    const notify = vi.fn(() => Promise.resolve());

    const deps = makeDeps({
      emailProvider: { send: sendMock },
      subscribersRepo: {
        listConfirmed: vi.fn().mockResolvedValue(subs),
        findByIds: vi.fn().mockResolvedValue(subs),
      },
      slackNotifier: { notifyNewsletterSent: notify },
    });

    await handleNewsletterSendJob(deps, {
      name: "send-newsletter",
      id: "j1",
      data: { runId: "run-uuid-1234", subscriberIds: "all" },
    });

    expect(notify).toHaveBeenCalledOnce();
    const arg = notify.mock.calls[0]?.[0] as {
      runId: string;
      delivery: {
        attempted: number;
        sent: number;
        failed: number;
        failureReasons?: { reason: string; count: number }[];
      };
    };
    expect(arg.runId).toBe("run-uuid-1234");
    expect(arg.delivery.attempted).toBe(4);
    expect(arg.delivery.sent).toBe(1);
    expect(arg.delivery.failed).toBe(3);
    expect(arg.delivery.failureReasons).toEqual([
      { reason: "rate limit", count: 2 },
      { reason: "unverified sender domain", count: 1 },
    ]);
  });

  it("calls slackNotifier with no failureReasons on a fully-successful send", async () => {
    const sub = makeSubscriber();
    const notify = vi.fn(() => Promise.resolve());
    const deps = makeDeps({
      emailProvider: { send: vi.fn().mockResolvedValue({ messageId: "ok" }) },
      subscribersRepo: {
        listConfirmed: vi.fn().mockResolvedValue([sub]),
        findByIds: vi.fn().mockResolvedValue([sub]),
      },
      slackNotifier: { notifyNewsletterSent: notify },
    });

    await handleNewsletterSendJob(deps, {
      name: "send-newsletter",
      id: "j1",
      data: { runId: "run-uuid-1234", subscriberIds: "all" },
    });

    expect(notify).toHaveBeenCalledOnce();
    const arg = notify.mock.calls[0]?.[0] as {
      delivery: {
        sent: number;
        failed: number;
        failureReasons?: unknown;
      };
    };
    expect(arg.delivery.sent).toBe(1);
    expect(arg.delivery.failed).toBe(0);
    expect(arg.delivery.failureReasons).toBeUndefined();
  });
});
