import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type { SubscriberSelect, SubscriberInsert, SubscriberStatus } from "@newsletter/shared";
import { createSubscribeRouter } from "@api/routes/subscribe.js";
import type { SubscribersRepo } from "@api/repositories/subscribers.js";
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

function makeRepo(existing: SubscriberSelect | null = null): SubscribersRepo & {
  created: SubscriberInsert[];
  updated: { id: string; status: SubscriberStatus }[];
} {
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
    updateStatus: vi.fn((id: string, status: SubscriberStatus) => {
      updated.push({ id, status });
      return Promise.resolve(makeSubscriber({ id, status }));
    }),
    listConfirmed: vi.fn(() => Promise.resolve([])),
  };

  return Object.assign(repo, { created, updated });
}

function buildApp(opts: {
  repo: SubscribersRepo;
  sendConfirmationEmail?: (email: string, confirmUrl: string) => Promise<void>;
  sendNewsletterToSubscriber?: (runId: string, subscriberId: string) => Promise<void>;
  getTodaysReviewedArchiveId?: () => Promise<string | null>;
}): Hono {
  const app = new Hono();
  const router = createSubscribeRouter({
    subscribersRepo: opts.repo,
    sessionSecret: SECRET,
    baseUrl: BASE_URL,
    sendConfirmationEmail: opts.sendConfirmationEmail ?? vi.fn(() => Promise.resolve()),
    sendNewsletterToSubscriber:
      opts.sendNewsletterToSubscriber ?? vi.fn(() => Promise.resolve()),
    getTodaysReviewedArchiveId: opts.getTodaysReviewedArchiveId ?? (() => Promise.resolve(null)),
  });
  app.route("/api", router);
  return app;
}

describe("POST /api/subscribe", () => {
  it("REQ-003: returns 200, creates subscriber, calls sendConfirmationEmail", async () => {
    const repo = makeRepo(null);
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
    const repo = makeRepo(existing);
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
    const repo = makeRepo(null);
    const app = buildApp({ repo });

    const res = await app.request("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "not-an-email" }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for missing body", async () => {
    const repo = makeRepo(null);
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
    const repo = makeRepo(subscriber);
    const app = buildApp({ repo });

    const token = issueSubscriberToken(subscriber.id, "confirm", SECRET);
    const res = await app.request(`/api/confirm?token=${token}`);

    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toBe("/confirm?status=success");
    expect(repo.updateStatus).toHaveBeenCalledWith(
      subscriber.id,
      "confirmed",
      expect.objectContaining({ subscribedAt: expect.any(Date) }),
    );
  });

  it("REQ-007: expired token → redirects to /confirm?status=expired, no update", async () => {
    const subscriber = makeSubscriber();
    const repo = makeRepo(subscriber);
    const app = buildApp({ repo });

    const pastDate = new Date(Date.now() - 1000);
    const token = issueSubscriberToken(subscriber.id, "confirm", SECRET, pastDate);
    const res = await app.request(`/api/confirm?token=${token}`);

    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toBe("/confirm?status=expired");
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });

  it("REQ-008: invalid token → redirects to /confirm?status=invalid", async () => {
    const repo = makeRepo(null);
    const app = buildApp({ repo });

    const res = await app.request("/api/confirm?token=garbage");

    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toBe("/confirm?status=invalid");
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });

  it("REQ-006: when todaysArchiveId exists, sendNewsletterToSubscriber is called", async () => {
    const subscriber = makeSubscriber();
    const repo = makeRepo(subscriber);
    const sendNewsletterToSubscriber = vi.fn(() => Promise.resolve());
    const app = buildApp({
      repo,
      sendNewsletterToSubscriber,
      getTodaysReviewedArchiveId: () => Promise.resolve("archive-123"),
    });

    const token = issueSubscriberToken(subscriber.id, "confirm", SECRET);
    const res = await app.request(`/api/confirm?token=${token}`);

    expect(res.status).toBe(302);
    expect(sendNewsletterToSubscriber).toHaveBeenCalledWith("archive-123", subscriber.id);
  });

  it("EDGE-005: when todaysArchiveId is null, sendNewsletterToSubscriber is NOT called", async () => {
    const subscriber = makeSubscriber();
    const repo = makeRepo(subscriber);
    const sendNewsletterToSubscriber = vi.fn(() => Promise.resolve());
    const app = buildApp({
      repo,
      sendNewsletterToSubscriber,
      getTodaysReviewedArchiveId: () => Promise.resolve(null),
    });

    const token = issueSubscriberToken(subscriber.id, "confirm", SECRET);
    await app.request(`/api/confirm?token=${token}`);

    expect(sendNewsletterToSubscriber).not.toHaveBeenCalled();
  });
});

describe("GET /api/unsubscribe", () => {
  it("REQ-015: valid token → redirects to /unsubscribe?status=success, subscriber unsubscribed", async () => {
    const subscriber = makeSubscriber({ status: "confirmed" });
    const repo = makeRepo(subscriber);
    const app = buildApp({ repo });

    const token = issueSubscriberToken(subscriber.id, "unsub", SECRET);
    const res = await app.request(`/api/unsubscribe?token=${token}`);

    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toBe("/unsubscribe?status=success");
    expect(repo.updateStatus).toHaveBeenCalledWith(
      subscriber.id,
      "unsubscribed",
      expect.objectContaining({ unsubscribedAt: expect.any(Date) }),
    );
  });

  it("REQ-017: invalid token → still redirects to /unsubscribe?status=success (idempotent)", async () => {
    const repo = makeRepo(null);
    const app = buildApp({ repo });

    const res = await app.request("/api/unsubscribe?token=invalid-token");

    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toBe("/unsubscribe?status=success");
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });
});

describe("POST /api/unsubscribe", () => {
  it("REQ-016: Gmail one-click unsubscribe returns 200", async () => {
    const subscriber = makeSubscriber({ status: "confirmed" });
    const repo = makeRepo(subscriber);
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
