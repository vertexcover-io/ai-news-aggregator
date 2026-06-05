import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type { SubscriberSelect, SubscriberInsert, SubscriberStatus, SlackNotifier } from "@newsletter/shared";
import { createSubscribeRouter } from "@api/routes/subscribe.js";
import type { SubscribersRepo, SubscriberStatusUpdateResult } from "@api/repositories/subscribers.js";
import { issueSubscriberToken } from "@api/lib/subscriber-token.js";

const SECRET = "test-secret";
const BASE_URL = "https://example.com";

function makeSubscriber(overrides: Partial<SubscriberSelect> = {}): SubscriberSelect {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    email: "test@example.com",
    status: "pending",
    confirmToken: null,
    confirmTokenExpiresAt: null,
    subscribedAt: null,
    unsubscribedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeSlackNotifier() {
  return {
    notifyNewsletterSent: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    notifyReviewPending: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    notifyReviewWarning: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    notifyPublishFailed: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    notifyPublishUnavailable: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    notifySourceDistribution: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    notifyEmailDelivery: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    notifyLinkedinPosted: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    notifyTwitterPosted: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    notifySubscriberConfirmed: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    notifySubscriberRemoved: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
  } satisfies SlackNotifier;
}

function makeRepo(opts: {
  existing?: SubscriberSelect | null;
  /** When true, updateStatus returns changed:false (idempotent replay) */
  unchanged?: boolean;
  confirmedCount?: number;
} = {}): SubscribersRepo & {
  created: SubscriberInsert[];
  updated: { id: string; status: SubscriberStatus }[];
} {
  const { existing = null, unchanged = false, confirmedCount = 1 } = opts;
  const created: SubscriberInsert[] = [];
  const updated: { id: string; status: SubscriberStatus }[] = [];

  const repo: SubscribersRepo = {
    findByEmail: vi.fn(() => Promise.resolve(existing)),
    findById: vi.fn((id: string) => {
      if (existing?.id === id) return Promise.resolve(existing);
      return Promise.resolve(null);
    }),
    findByIds: vi.fn(() => Promise.resolve(existing ? [existing] : [])),
    create: vi.fn((insert: SubscriberInsert) => {
      created.push(insert);
      return Promise.resolve(makeSubscriber({ email: insert.email ?? "" }));
    }),
    updateConfirmToken: vi.fn(() => Promise.resolve()),
    updateStatus: vi.fn((id: string, status: SubscriberStatus): Promise<SubscriberStatusUpdateResult> => {
      updated.push({ id, status });
      const row = existing ? { ...existing, id, status } : makeSubscriber({ id, status });
      if (unchanged) {
        return Promise.resolve({ changed: false, next: status, row });
      }
      return Promise.resolve({ changed: true, next: status, row });
    }),
    listConfirmed: vi.fn(() => Promise.resolve([])),
    countConfirmed: vi.fn(() => Promise.resolve(confirmedCount)),
  };

  return Object.assign(repo, { created, updated });
}

type SubscribeRouterDeps = Parameters<typeof createSubscribeRouter>[0];

function makeLogger(): Record<"info" | "warn" | "error" | "debug", ReturnType<typeof vi.fn>> {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function buildApp(opts: {
  repo: SubscribersRepo;
  slackNotifier?: SlackNotifier;
  sendConfirmationEmail?: (email: string, confirmUrl: string) => Promise<void>;
  sendNewsletterToSubscriber?: (runId: string, subscriberId: string) => Promise<void>;
  getMostRecentReviewedArchiveId?: () => Promise<string | null>;
  logger?: ReturnType<typeof makeLogger>;
}): Hono {
  const app = new Hono();
  const router = createSubscribeRouter({
    subscribersRepo: opts.repo,
    sessionSecret: SECRET,
    baseUrl: BASE_URL,
    webBaseUrl: BASE_URL,
    sendConfirmationEmail: opts.sendConfirmationEmail ?? vi.fn(() => Promise.resolve()),
    sendNewsletterToSubscriber:
      opts.sendNewsletterToSubscriber ?? vi.fn(() => Promise.resolve()),
    getMostRecentReviewedArchiveId: opts.getMostRecentReviewedArchiveId ?? (() => Promise.resolve(null)),
    slackNotifier: opts.slackNotifier ?? makeSlackNotifier(),
    ...(opts.logger === undefined
      ? {}
      : { logger: opts.logger as unknown as SubscribeRouterDeps["logger"] }),
  });
  app.route("/api", router);
  return app;
}

describe("POST /api/subscribe", () => {
  it("REQ-003: returns 200, creates subscriber, calls sendConfirmationEmail", async () => {
    const repo = makeRepo();
    const sendConfirmationEmail = vi.fn(() => Promise.resolve());
    const app = buildApp({ repo, sendConfirmationEmail });

    const res = await app.request("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "new@example.com" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    expect(repo.create).toHaveBeenCalledOnce();
    expect(sendConfirmationEmail).toHaveBeenCalledOnce();
  });

  it("REQ-004: returns 200 silently if email already exists, does NOT call create", async () => {
    const existing = makeSubscriber({ email: "existing@example.com" });
    const repo = makeRepo({ existing });
    const sendConfirmationEmail = vi.fn(() => Promise.resolve());
    const app = buildApp({ repo, sendConfirmationEmail });

    const res = await app.request("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "existing@example.com" }),
    });

    expect(res.status).toBe(200);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("EDGE-018: returns 400 for invalid email format", async () => {
    const repo = makeRepo();
    const app = buildApp({ repo });

    const res = await app.request("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "not-an-email" }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for missing body", async () => {
    const repo = makeRepo();
    const app = buildApp({ repo });

    const res = await app.request("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });
});

describe("GET /api/confirm", () => {
  it("REQ-005: valid token → redirects to /confirm?status=success, subscriber updated", async () => {
    const subscriber = makeSubscriber();
    const repo = makeRepo({ existing: subscriber });
    const app = buildApp({ repo });

    const token = issueSubscriberToken(subscriber.id, "confirm", SECRET);
    const res = await app.request(`/api/confirm?token=${token}`);

    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toBe(`${BASE_URL}/confirm?status=success`);
    expect(repo.updateStatus).toHaveBeenCalledWith(
      subscriber.id,
      "confirmed",
      expect.objectContaining({ subscribedAt: expect.any(Date) }),
    );
  });

  it("REQ-007: expired token → redirects to /confirm?status=expired, no update", async () => {
    const subscriber = makeSubscriber();
    const repo = makeRepo({ existing: subscriber });
    const app = buildApp({ repo });

    const pastDate = new Date(Date.now() - 1000);
    const token = issueSubscriberToken(subscriber.id, "confirm", SECRET, pastDate);
    const res = await app.request(`/api/confirm?token=${token}`);

    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toBe(`${BASE_URL}/confirm?status=expired`);
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });

  it("REQ-008: invalid token → redirects to /confirm?status=invalid", async () => {
    const repo = makeRepo();
    const app = buildApp({ repo });

    const res = await app.request("/api/confirm?token=garbage");

    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toBe(`${BASE_URL}/confirm?status=invalid`);
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });

  it("REQ-006: when a recent reviewed archive exists, sendNewsletterToSubscriber is called", async () => {
    const subscriber = makeSubscriber();
    const repo = makeRepo({ existing: subscriber });
    const sendNewsletterToSubscriber = vi.fn(() => Promise.resolve());
    const app = buildApp({
      repo,
      sendNewsletterToSubscriber,
      getMostRecentReviewedArchiveId: () => Promise.resolve("archive-123"),
    });

    const token = issueSubscriberToken(subscriber.id, "confirm", SECRET);
    const res = await app.request(`/api/confirm?token=${token}`);

    expect(res.status).toBe(302);
    expect(sendNewsletterToSubscriber).toHaveBeenCalledWith("archive-123", subscriber.id);
  });

  it("EDGE-005: when no reviewed archive exists, sendNewsletterToSubscriber is NOT called", async () => {
    const subscriber = makeSubscriber();
    const repo = makeRepo({ existing: subscriber });
    const sendNewsletterToSubscriber = vi.fn(() => Promise.resolve());
    const app = buildApp({
      repo,
      sendNewsletterToSubscriber,
      getMostRecentReviewedArchiveId: () => Promise.resolve(null),
    });

    const token = issueSubscriberToken(subscriber.id, "confirm", SECRET);
    await app.request(`/api/confirm?token=${token}`);

    expect(sendNewsletterToSubscriber).not.toHaveBeenCalled();
  });
});

describe("GET /api/unsubscribe", () => {
  it("REQ-015: valid token → redirects to /unsubscribe?status=success, subscriber unsubscribed", async () => {
    const subscriber = makeSubscriber({ status: "confirmed" });
    const repo = makeRepo({ existing: subscriber });
    const app = buildApp({ repo });

    const token = issueSubscriberToken(subscriber.id, "unsub", SECRET);
    const res = await app.request(`/api/unsubscribe?token=${token}`);

    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toBe(`${BASE_URL}/unsubscribe?status=success`);
    expect(repo.updateStatus).toHaveBeenCalledWith(
      subscriber.id,
      "unsubscribed",
      expect.objectContaining({ unsubscribedAt: expect.any(Date) }),
    );
  });

  it("REQ-017: invalid token → still redirects to /unsubscribe?status=success (idempotent)", async () => {
    const repo = makeRepo();
    const app = buildApp({ repo });

    const res = await app.request("/api/unsubscribe?token=invalid-token");

    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toBe(`${BASE_URL}/unsubscribe?status=success`);
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });
});

describe("POST /api/unsubscribe", () => {
  it("REQ-016: Gmail one-click unsubscribe returns 200", async () => {
    const subscriber = makeSubscriber({ status: "confirmed" });
    const repo = makeRepo({ existing: subscriber });
    const app = buildApp({ repo });

    const token = issueSubscriberToken(subscriber.id, "unsub", SECRET);
    const res = await app.request("/api/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `List-Unsubscribe=One-Click&token=${token}`,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });
});

// ---- VS-1..VS-7: Slack notification wiring ----

describe("VS-1: GET /api/confirm — subscribe + confirm fires notifySubscriberConfirmed", () => {
  it("calls notifySubscriberConfirmed once with the subscriber email and totalConfirmed", async () => {
    const subscriber = makeSubscriber({ email: "alice@example.com", status: "pending" });
    const repo = makeRepo({ existing: subscriber, confirmedCount: 5 });
    const slackNotifier = makeSlackNotifier();
    const { notifySubscriberConfirmed } = slackNotifier;
    const app = buildApp({ repo, slackNotifier });

    const token = issueSubscriberToken(subscriber.id, "confirm", SECRET);
    const res = await app.request(`/api/confirm?token=${token}`);

    expect(res.status).toBe(302);
    // The Slack call is void-fired; flush microtasks to let the promise chain settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(notifySubscriberConfirmed).toHaveBeenCalledOnce();
    expect(notifySubscriberConfirmed).toHaveBeenCalledWith({
      email: subscriber.email,
      totalConfirmed: 5,
    });
  });
});

describe("VS-2: GET /api/confirm — replayed confirm (changed:false) does NOT fire notifySubscriberConfirmed", () => {
  it("notifySubscriberConfirmed is never called when updateStatus returns changed:false", async () => {
    const subscriber = makeSubscriber({ email: "alice@example.com", status: "confirmed" });
    const repo = makeRepo({ existing: subscriber, unchanged: true });
    const slackNotifier = makeSlackNotifier();
    const { notifySubscriberConfirmed } = slackNotifier;
    const app = buildApp({ repo, slackNotifier });

    const token = issueSubscriberToken(subscriber.id, "confirm", SECRET);
    const res = await app.request(`/api/confirm?token=${token}`);

    expect(res.status).toBe(302);
    await new Promise((r) => setTimeout(r, 0));
    expect(notifySubscriberConfirmed).not.toHaveBeenCalled();
  });
});

describe("VS-3: GET /api/unsubscribe — valid token fires notifySubscriberRemoved via:unsubscribe-link", () => {
  it("calls notifySubscriberRemoved with via:unsubscribe-link", async () => {
    const subscriber = makeSubscriber({ status: "confirmed", email: "bob@example.com" });
    const repo = makeRepo({ existing: subscriber, confirmedCount: 4 });
    const slackNotifier = makeSlackNotifier();
    const { notifySubscriberRemoved } = slackNotifier;
    const app = buildApp({ repo, slackNotifier });

    const token = issueSubscriberToken(subscriber.id, "unsub", SECRET);
    const res = await app.request(`/api/unsubscribe?token=${token}`);

    expect(res.status).toBe(302);
    await new Promise((r) => setTimeout(r, 0));
    expect(notifySubscriberRemoved).toHaveBeenCalledOnce();
    expect(notifySubscriberRemoved).toHaveBeenCalledWith({
      email: subscriber.email,
      via: "unsubscribe-link",
      totalConfirmed: 4,
    });
  });
});

describe("VS-4: POST /api/unsubscribe — one-click fires notifySubscriberRemoved via:one-click", () => {
  it("calls notifySubscriberRemoved with via:one-click", async () => {
    const subscriber = makeSubscriber({ status: "confirmed", email: "carol@example.com" });
    const repo = makeRepo({ existing: subscriber, confirmedCount: 3 });
    const slackNotifier = makeSlackNotifier();
    const { notifySubscriberRemoved } = slackNotifier;
    const app = buildApp({ repo, slackNotifier });

    const token = issueSubscriberToken(subscriber.id, "unsub", SECRET);
    const res = await app.request("/api/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `List-Unsubscribe=One-Click&token=${token}`,
    });

    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
    expect(notifySubscriberRemoved).toHaveBeenCalledOnce();
    expect(notifySubscriberRemoved).toHaveBeenCalledWith({
      email: subscriber.email,
      via: "one-click",
      totalConfirmed: 3,
    });
  });
});

describe("VS-5: unsubscribe of already-unsubscribed subscriber does NOT fire Slack", () => {
  it("notifySubscriberRemoved is never called when updateStatus returns changed:false", async () => {
    const subscriber = makeSubscriber({ status: "unsubscribed", email: "dave@example.com" });
    const repo = makeRepo({ existing: subscriber, unchanged: true });
    const slackNotifier = makeSlackNotifier();
    const { notifySubscriberRemoved } = slackNotifier;
    const app = buildApp({ repo, slackNotifier });

    const token = issueSubscriberToken(subscriber.id, "unsub", SECRET);
    const res = await app.request(`/api/unsubscribe?token=${token}`);

    expect(res.status).toBe(302);
    await new Promise((r) => setTimeout(r, 0));
    expect(notifySubscriberRemoved).not.toHaveBeenCalled();
  });
});

describe("VS-6: Slack webhook throws — confirm still succeeds and logs the failure", () => {
  it("redirects 302, persists the confirmation, and warn-logs the slack throw", async () => {
    const subscriber = makeSubscriber({ email: "eve@example.com", status: "pending" });
    const repo = makeRepo({ existing: subscriber });
    const slackNotifier = makeSlackNotifier();
    const { notifySubscriberConfirmed } = slackNotifier;
    (notifySubscriberConfirmed as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("network error"),
    );
    const logger = makeLogger();
    const app = buildApp({ repo, slackNotifier, logger });

    const token = issueSubscriberToken(subscriber.id, "confirm", SECRET);
    const res = await app.request(`/api/confirm?token=${token}`);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${BASE_URL}/confirm?status=success`);
    // The confirmation was still persisted despite the Slack failure.
    expect(repo.updateStatus).toHaveBeenCalledWith(
      subscriber.id,
      "confirmed",
      expect.objectContaining({ subscribedAt: expect.any(Date) }),
    );
    // Allow the void-fired .catch() microtask to settle, then assert the
    // failure was warn-logged rather than swallowed silently.
    await new Promise((r) => setTimeout(r, 0));
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "slack.subscriber_confirmed.unexpected_throw",
        error: "network error",
      }),
      expect.any(String),
    );
  });
});
