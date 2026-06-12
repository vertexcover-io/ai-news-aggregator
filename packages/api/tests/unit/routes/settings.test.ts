import { describe, it, expect, vi } from "vitest";
import { setTestTenant } from "../../helpers/tenant.js";
import { Hono } from "hono";
import type { UserSettings } from "@newsletter/shared";
import { createSettingsRouter } from "@api/routes/settings.js";
import type {
  NotificationSettingsRepo,
  TenantNotificationSettings,
  UserSettingsRepo,
} from "@api/repositories/user-settings.js";
import type { EncryptedBlob } from "@newsletter/shared/services/credential-cipher";
import type {
  TenantFeatureFlags,
  TenantFeaturesRepo,
} from "@api/repositories/tenant-features.js";

function makeRepo(initial: UserSettings | null = null): {
  repo: UserSettingsRepo;
  store: { current: UserSettings | null };
  upsertCalls: number;
} {
  const store = { current: initial };
  let upsertCalls = 0;
  const repo: UserSettingsRepo = {
    get: () => Promise.resolve(store.current),
    upsert: (input) => {
      upsertCalls += 1;
      const saved: UserSettings = {
        id: "00000000-0000-0000-0000-000000000001",
        topN: input.topN,
        halfLifeHours: input.halfLifeHours,
        hnEnabled: input.hnEnabled,
        hnConfig: input.hnConfig,
        redditEnabled: input.redditEnabled,
        redditConfig: input.redditConfig,
        webEnabled: input.webEnabled,
        webConfig: input.webConfig,
        twitterEnabled: input.twitterEnabled,
        twitterConfig: input.twitterConfig,
        webSearchEnabled: input.webSearchEnabled ?? false,
        webSearchConfig: input.webSearchConfig ?? null,
        posthogEnabled: input.posthogEnabled,
        posthogProjectToken: input.posthogProjectToken,
        posthogHost: input.posthogHost,
        scheduleTime: input.pipelineTime,
        pipelineTime: input.pipelineTime,
        emailTime: input.emailTime,
        linkedinTime: input.linkedinTime,
        twitterTime: input.twitterTime,
        scheduleTimezone: input.scheduleTimezone,
        scheduleEnabled: input.scheduleEnabled,
        emailEnabled: input.emailEnabled,
        linkedinEnabled: input.linkedinEnabled,
        twitterPostEnabled: input.twitterPostEnabled,
        autoReview: input.autoReview,
        updatedAt: new Date().toISOString(),
      };
      store.current = saved;
      return Promise.resolve(saved);
    },
  };
  return {
    repo,
    store,
    get upsertCalls() {
      return upsertCalls;
    },
  } as { repo: UserSettingsRepo; store: { current: UserSettings | null }; upsertCalls: number };
}

function makeNotificationRepo(
  initial: TenantNotificationSettings = { notificationEmail: null, slackWebhookEncrypted: null },
) {
  const store = { current: { ...initial } };
  const repo: NotificationSettingsRepo = {
    get: vi.fn(() => Promise.resolve({ ...store.current })),
    update: vi.fn((input) => {
      if (input.notificationEmail !== undefined) {
        store.current.notificationEmail = input.notificationEmail;
      }
      if (input.slackWebhookEncrypted !== undefined) {
        store.current.slackWebhookEncrypted = input.slackWebhookEncrypted;
      }
      return Promise.resolve();
    }),
  };
  return { repo, store };
}

function makeCipher() {
  return {
    encrypt: vi.fn(
      (plaintext: string): EncryptedBlob => ({ ct: `enc(${plaintext})`, iv: "iv", tag: "tag" }),
    ),
  };
}

function makeFeaturesRepo(
  initial: TenantFeatureFlags = {
    canonEnabled: false,
    deliverabilityEnabled: false,
    evalEnabled: false,
  },
) {
  const store = { current: { ...initial } };
  const repo: TenantFeaturesRepo = {
    get: vi.fn(() => Promise.resolve({ ...store.current })),
    update: vi.fn((_tenantId: string, patch: Partial<TenantFeatureFlags>) => {
      store.current = { ...store.current, ...patch };
      return Promise.resolve({ ...store.current });
    }),
  };
  return { repo, store };
}

function makeQueue() {
  const upsertJobScheduler = vi.fn(() => Promise.resolve({ id: "sched" }));
  const removeJobScheduler = vi.fn(() => Promise.resolve(true));
  return { upsertJobScheduler, removeJobScheduler };
}

function makeSourcesSync() {
  return { replaceAll: vi.fn(() => Promise.resolve([])) };
}

function buildApp(
  repo: UserSettingsRepo,
  queue: ReturnType<typeof makeQueue>,
  resolveHandles?: (
    handles: string[],
  ) => Promise<{ handle: string; userId: string }[]>,
  sourcesSync: ReturnType<typeof makeSourcesSync> = makeSourcesSync(),
  tenantId?: string,
  isTenantActive: (tenantId: string) => Promise<boolean> = () =>
    Promise.resolve(true),
  notificationRepo: NotificationSettingsRepo = makeNotificationRepo().repo,
  cipher: ReturnType<typeof makeCipher> = makeCipher(),
  tenantFeatures: TenantFeaturesRepo = makeFeaturesRepo().repo,
) {
  const app = new Hono();
  app.use("*", setTestTenant(tenantId));
  app.route(
    "/api/settings",
    createSettingsRouter({
      getSettingsRepo: () => repo,
      getNotificationSettingsRepo: () => notificationRepo,
      cipher,
      getSourcesRepo: () => sourcesSync,
      processingQueue: queue as never,
      collectorHealthQueue: queue as never,
      isTenantActive,
      tenantFeatures,
      resolveHandles: resolveHandles
        ? (handles) => resolveHandles(handles)
        : undefined,
      rettiwtFactory: () => ({}) as never,
    }),
  );
  return app;
}

const validBody = {
  topN: 10,
  halfLifeHours: null,
  hnEnabled: true,
  hnConfig: { sinceDays: 1 },
  redditEnabled: false,
  redditConfig: null,
  webEnabled: false,
  webConfig: null,
  twitterEnabled: false,
  twitterConfig: null,
  posthogEnabled: false,
  posthogProjectToken: null,
  posthogHost: null,
  scheduleTime: "09:30",
  pipelineTime: "09:30",
  emailTime: "10:00",
  linkedinTime: "10:15",
  twitterTime: "10:30",
  scheduleTimezone: "America/New_York",
  scheduleEnabled: true,
  emailEnabled: true,
  linkedinEnabled: true,
  twitterPostEnabled: true,
  autoReview: false,
  rankingPrompt: "Default ranking prompt for tests",
  shortlistPrompt: "Default shortlist prompt for tests",
  shortlistSize: 30,
};

describe("GET /api/settings", () => {
  it("REQ-010: returns null when no row exists", async () => {
    const { repo } = makeRepo(null);
    const app = buildApp(repo, makeQueue());
    const res = await app.request("/api/settings");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });

  it("REQ-010: returns the current settings when a row exists", async () => {
    const existing: UserSettings = {
      id: "id-1",
      topN: 15,
      halfLifeHours: null,
      hnEnabled: false,
      hnConfig: null,
      redditEnabled: false,
      redditConfig: null,
      webEnabled: false,
      webConfig: null,
      twitterEnabled: false,
      twitterConfig: null,
      posthogEnabled: false,
      posthogProjectToken: null,
      posthogHost: null,
      scheduleTime: "08:00",
      pipelineTime: "08:00",
      emailTime: "08:30",
      linkedinTime: "08:45",
      twitterTime: "09:00",
      scheduleTimezone: "UTC",
      scheduleEnabled: false,
      emailEnabled: true,
      linkedinEnabled: true,
      twitterPostEnabled: true,
      autoReview: false,
      rankingPrompt: "Default ranking prompt",
      shortlistPrompt: "Default shortlist prompt",
      shortlistSize: 30,
      updatedAt: new Date().toISOString(),
    };
    const { repo } = makeRepo(existing);
    const app = buildApp(repo, makeQueue());
    const res = await app.request("/api/settings");
    expect(res.status).toBe(200);
    const body = (await res.json()) as UserSettings;
    expect(body.topN).toBe(15);
  });
});

describe("PUT /api/settings", () => {
  it("REQ-011: validates, persists, and returns the row", async () => {
    const { repo, store } = makeRepo(null);
    const app = buildApp(repo, makeQueue());
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as UserSettings;
    expect(body.topN).toBe(10);
    expect(store.current).not.toBeNull();
  });

  it("accepts and persists PostHog analytics config", async () => {
    const { repo, store } = makeRepo(null);
    const app = buildApp(repo, makeQueue());
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        posthogEnabled: true,
        posthogProjectToken: "phc_project_token",
        posthogHost: "https://us.i.posthog.com",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.posthogEnabled).toBe(true);
    expect(body.posthogProjectToken).toBe("phc_project_token");
    expect(body.posthogHost).toBe("https://us.i.posthog.com");
    expect(store.current).toMatchObject({
      posthogEnabled: true,
      posthogProjectToken: "phc_project_token",
      posthogHost: "https://us.i.posthog.com",
    });
  });

  it("rejects invalid PostHog host URLs", async () => {
    const { repo } = makeRepo(null);
    const app = buildApp(repo, makeQueue());
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        posthogEnabled: true,
        posthogProjectToken: "phc_project_token",
        posthogHost: "not-a-url",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("REQ-012: returns 400 with issues on invalid body", async () => {
    const { repo } = makeRepo(null);
    const app = buildApp(repo, makeQueue());
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, topN: 0 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: unknown[] };
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it("accepts overnight publish windows where publish times are earlier than pipelineTime", async () => {
    const { repo, store } = makeRepo(null);
    const app = buildApp(repo, makeQueue());
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        pipelineTime: "19:00",
        scheduleTime: "19:00",
        emailTime: "09:00",
        linkedinTime: "09:15",
        twitterTime: "09:30",
      }),
    });

    expect(res.status).toBe(200);
    expect(store.current?.emailTime).toBe("09:00");
  });

  it("rejects publish times equal to pipelineTime", async () => {
    const { repo } = makeRepo(null);
    const app = buildApp(repo, makeQueue());
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        pipelineTime: "19:00",
        scheduleTime: "19:00",
        emailTime: "19:00",
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(
      expect.objectContaining({
        fields: expect.arrayContaining(["emailTime"]),
        issues: expect.arrayContaining([
          expect.objectContaining({ message: "must differ from pipelineTime" }),
        ]),
      }),
    );
  });

  it("REQ-013: returns 400 when scheduleEnabled=true with no sources", async () => {
    const { repo } = makeRepo(null);
    const app = buildApp(repo, makeQueue());
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        hnEnabled: false,
        hnConfig: null,
        redditEnabled: false,
        redditConfig: null,
        webEnabled: false,
        webConfig: null,
        twitterEnabled: false,
        twitterConfig: null,
        }),
    });
    expect(res.status).toBe(400);
  });

  it("REQ-014: triggers reconciliation (enabled -> upsertJobScheduler)", async () => {
    const { repo } = makeRepo(null);
    const queue = makeQueue();
    const app = buildApp(repo, queue);
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(200);
    // 5 from reconcilePipelineSchedule + 1 from reconcileCollectorHealthSchedule
    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(6);
    expect(queue.removeJobScheduler).not.toHaveBeenCalled();
  });

  it("preserves collector config when that collector is disabled", async () => {
    const { repo, store } = makeRepo(null);
    const app = buildApp(repo, makeQueue());
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        hnEnabled: false,
        hnConfig: { sinceDays: 3, keywords: ["agents"] },
        scheduleEnabled: false,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as UserSettings;
    expect(body.hnEnabled).toBe(false);
    expect(body.hnConfig).toEqual({ sinceDays: 3, keywords: ["agents"] });
    expect(store.current?.hnConfig).toEqual({ sinceDays: 3, keywords: ["agents"] });
  });

  // Phase 6 removed the tenant-0 gate: every tenant's PUT reconciles its OWN
  // schedulers (REQ-063) — keys and job data are scoped to the caller's tenant.
  it("REQ-063: a non-zero tenant's PUT reconciles that tenant's schedulers, not tenant 0's", async () => {
    const tenantId = "aaaaaaaa-0000-4000-8000-000000000042";
    const { repo } = makeRepo(null);
    const queue = makeQueue();
    const app = buildApp(repo, queue, undefined, makeSourcesSync(), tenantId);
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(200);
    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(6);
    const calls = queue.upsertJobScheduler.mock.calls as unknown as [
      string,
      unknown,
      { data: Record<string, unknown> },
    ][];
    for (const [key, , template] of calls) {
      expect(key.endsWith(`:${tenantId}`)).toBe(true);
      expect(template.data.tenantId).toBe(tenantId);
    }
  });

  // A pending_setup tenant must not get live schedulers from a settings save —
  // activation (Phase 11) runs the reconcile once the tenant goes active.
  it("non-active tenant: PUT saves settings but skips scheduler reconcile", async () => {
    const { repo, store } = makeRepo(null);
    const queue = makeQueue();
    const isTenantActive = vi.fn(() => Promise.resolve(false));
    const app = buildApp(
      repo,
      queue,
      undefined,
      makeSourcesSync(),
      undefined,
      isTenantActive,
    );
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(200);
    expect(store.current).not.toBeNull();
    expect(isTenantActive).toHaveBeenCalled();
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
    expect(queue.removeJobScheduler).not.toHaveBeenCalled();
  });

  it("REQ-014/REQ-022: disabled schedule removes the scheduler", async () => {
    const { repo } = makeRepo(null);
    const queue = makeQueue();
    const app = buildApp(repo, queue);
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, scheduleEnabled: false }),
    });
    expect(res.status).toBe(200);
    // 5 from reconcilePipelineSchedule + 1 from reconcileCollectorHealthSchedule
    expect(queue.removeJobScheduler).toHaveBeenCalledTimes(6);
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
  });

  it("REQ-045b: users with userId already set → no resolver call, persisted as-is", async () => {
    const { repo, store } = makeRepo(null);
    const resolver = vi.fn(() =>
      Promise.resolve([] as { handle: string; userId: string }[]),
    );
    const app = buildApp(repo, makeQueue(), resolver);
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        twitterConfig: {
          listIds: ["111"],
          users: [{ handle: "jack", userId: "12" }],
        },
      }),
    });
    expect(res.status).toBe(200);
    expect(resolver).not.toHaveBeenCalled();
    expect(store.current?.twitterConfig).toEqual({
      listIds: ["111"],
      users: [{ handle: "jack", userId: "12" }],
      maxTweetsPerSource: undefined,
      sinceHours: undefined,
    });
  });

  it("REQ-045: users missing userId → resolver called, persisted shape has both fields", async () => {
    const { repo, store } = makeRepo(null);
    const resolver = vi.fn(() =>
      Promise.resolve([{ handle: "jack", userId: "12" }]),
    );
    const app = buildApp(repo, makeQueue(), resolver);
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        twitterConfig: {
          listIds: [],
          users: [{ handle: "jack" }],
        },
      }),
    });
    expect(res.status).toBe(200);
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(resolver).toHaveBeenCalledWith(["jack"]);
    expect(store.current?.twitterConfig?.users).toEqual([
      { handle: "jack", userId: "12" },
    ]);
  });

  it("REQ-045: mixed resolved+unresolved users preserve order", async () => {
    const { repo, store } = makeRepo(null);
    const resolver = vi.fn((handles: string[]) =>
      Promise.resolve(
        handles.map((h) => ({ handle: h, userId: h === "alice" ? "100" : "200" })),
      ),
    );
    const app = buildApp(repo, makeQueue(), resolver);
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        twitterConfig: {
          listIds: [],
          users: [
            { handle: "jack", userId: "12" },
            { handle: "alice" },
            { handle: "bob" },
          ],
        },
      }),
    });
    expect(res.status).toBe(200);
    expect(resolver).toHaveBeenCalledWith(["alice", "bob"]);
    expect(store.current?.twitterConfig?.users).toEqual([
      { handle: "jack", userId: "12" },
      { handle: "alice", userId: "100" },
      { handle: "bob", userId: "200" },
    ]);
  });

  it("REQ-046: resolver throws not_found → 422 with failure list, settings unchanged", async () => {
    const existing: UserSettings = {
      id: "id-1",
      topN: 5,
      halfLifeHours: null,
      hnEnabled: false,
      hnConfig: null,
      redditEnabled: false,
      redditConfig: null,
      webEnabled: false,
      webConfig: null,
      twitterEnabled: false,
      twitterConfig: null,
      posthogEnabled: false,
      posthogProjectToken: null,
      posthogHost: null,
      scheduleTime: "08:00",
      pipelineTime: "08:00",
      emailTime: "08:30",
      linkedinTime: "08:45",
      twitterTime: "09:00",
      scheduleTimezone: "UTC",
      scheduleEnabled: false,
      emailEnabled: true,
      linkedinEnabled: true,
      twitterPostEnabled: true,
      autoReview: false,
      rankingPrompt: "Default ranking prompt",
      shortlistPrompt: "Default shortlist prompt",
      shortlistSize: 30,
      updatedAt: new Date().toISOString(),
    };
    const { repo, store } = makeRepo(existing);
    const { TwitterHandleResolutionError } = await import(
      "@api/services/twitter-handle-resolver.js"
    );
    const resolver = vi.fn(() =>
      Promise.resolve().then((): never => {
        throw new TwitterHandleResolutionError("ghost", "not_found");
      }),
    );
    const app = buildApp(repo, makeQueue(), resolver);
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        twitterConfig: {
          listIds: [],
          users: [{ handle: "ghost" }],
        },
      }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      error: string;
      failures: { handle: string; reason: string }[];
    };
    expect(body.failures).toEqual([{ handle: "ghost", reason: "not_found" }]);
    expect(store.current).toEqual(existing);
  });

  it("REQ-047: resolver throws missing_api_key → 503, settings unchanged", async () => {
    const { repo, store } = makeRepo(null);
    const { TwitterHandleResolutionError } = await import(
      "@api/services/twitter-handle-resolver.js"
    );
    const resolver = vi.fn(() =>
      Promise.resolve().then((): never => {
        throw new TwitterHandleResolutionError("jack", "missing_api_key");
      }),
    );
    const app = buildApp(repo, makeQueue(), resolver);
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        twitterConfig: { listIds: [], users: [{ handle: "jack" }] },
      }),
    });
    expect(res.status).toBe(503);
    expect(store.current).toBeNull();
  });

  it("resolver throws auth_failed → 503, settings unchanged", async () => {
    const { repo, store } = makeRepo(null);
    const { TwitterHandleResolutionError } = await import(
      "@api/services/twitter-handle-resolver.js"
    );
    const resolver = vi.fn(() =>
      Promise.resolve().then((): never => {
        throw new TwitterHandleResolutionError("jack", "auth_failed");
      }),
    );
    const app = buildApp(repo, makeQueue(), resolver);
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        twitterConfig: { listIds: [], users: [{ handle: "jack" }] },
      }),
    });
    expect(res.status).toBe(503);
    expect(store.current).toBeNull();
  });

  it("REQ-023: round-trips twitterConfig (PUT then GET returns same shape)", async () => {
    const { repo } = makeRepo(null);
    const resolver = vi.fn(() =>
      Promise.resolve([{ handle: "jack", userId: "12" }]),
    );
    const app = buildApp(repo, makeQueue(), resolver);
    const putRes = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        twitterConfig: {
          listIds: ["111"],
          users: [{ handle: "jack", userId: "12" }],
          maxTweetsPerSource: 50,
          sinceHours: 24,
        },
      }),
    });
    expect(putRes.status).toBe(200);
    const getRes = await app.request("/api/settings");
    const body = (await getRes.json()) as UserSettings;
    expect(body.twitterConfig).toEqual({
      listIds: ["111"],
      users: [{ handle: "jack", userId: "12" }],
      maxTweetsPerSource: 50,
      sinceHours: 24,
    });
  });

  it("EDGE-011: returns 400 for malformed JSON", async () => {
    const { repo } = makeRepo(null);
    const app = buildApp(repo, makeQueue());
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "not-json{",
    });
    expect(res.status).toBe(400);
  });
});

describe("PUT /api/settings sources write-through sync", () => {
  it("replaces the tenant's sources rows with the exploded legacy configs", async () => {
    const { repo } = makeRepo(null);
    const sourcesSync = makeSourcesSync();
    const app = buildApp(repo, makeQueue(), undefined, sourcesSync);
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        redditEnabled: true,
        redditConfig: { subreddits: ["LocalLLaMA", "MachineLearning"], sinceDays: 2 },
        webEnabled: false,
        webConfig: {
          sources: [{ name: "Anthropic", listingUrl: "https://www.anthropic.com/news" }],
          maxItems: 10,
        },
      }),
    });
    expect(res.status).toBe(200);
    expect(sourcesSync.replaceAll).toHaveBeenCalledTimes(1);
    expect(sourcesSync.replaceAll).toHaveBeenCalledWith([
      { type: "hn", config: { sinceDays: 1 }, enabled: true },
      { type: "reddit", config: { subreddit: "LocalLLaMA", sinceDays: 2 }, enabled: true },
      { type: "reddit", config: { subreddit: "MachineLearning", sinceDays: 2 }, enabled: true },
      {
        type: "web",
        config: { name: "Anthropic", listingUrl: "https://www.anthropic.com/news" },
        enabled: false,
      },
    ]);
  });

  it("does not touch the sources table when validation fails", async () => {
    const { repo } = makeRepo(null);
    const sourcesSync = makeSourcesSync();
    const app = buildApp(repo, makeQueue(), undefined, sourcesSync);
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topN: "nope" }),
    });
    expect(res.status).toBe(400);
    expect(sourcesSync.replaceAll).not.toHaveBeenCalled();
  });
});

describe("notification settings (REQ-092)", () => {
  function buildNotifApp(
    notif: ReturnType<typeof makeNotificationRepo>,
    cipher = makeCipher(),
  ) {
    const { repo } = makeRepo(null);
    return buildApp(
      repo,
      makeQueue(),
      undefined,
      makeSourcesSync(),
      undefined,
      undefined,
      notif.repo,
      cipher,
    );
  }

  it("PUT persists notificationEmail and stores the webhook encrypted, never echoing it back", async () => {
    const notif = makeNotificationRepo();
    const cipher = makeCipher();
    const app = buildNotifApp(notif, cipher);
    const webhook = "https://hooks.slack.com/services/T/B/SECRET";

    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        notificationEmail: "ops@tenant.io",
        slackWebhookUrl: webhook,
      }),
    });

    expect(res.status).toBe(200);
    expect(cipher.encrypt).toHaveBeenCalledWith(webhook);
    expect(notif.store.current.notificationEmail).toBe("ops@tenant.io");
    expect(notif.store.current.slackWebhookEncrypted).toEqual({
      ct: `enc(${webhook})`,
      iv: "iv",
      tag: "tag",
    });

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.notificationEmail).toBe("ops@tenant.io");
    expect(body.hasSlackWebhook).toBe(true);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(webhook);
    expect(serialized).not.toContain("enc(");
    expect(serialized).not.toContain("slackWebhookUrl");
    expect(serialized).not.toContain("slackWebhookEncrypted");
  });

  it("GET exposes notificationEmail + hasSlackWebhook but no webhook material", async () => {
    const notif = makeNotificationRepo({
      notificationEmail: "ops@tenant.io",
      slackWebhookEncrypted: { ct: "secret-ct", iv: "iv", tag: "tag" },
    });
    const { repo } = makeRepo(null);
    const app = buildApp(
      repo,
      makeQueue(),
      undefined,
      makeSourcesSync(),
      undefined,
      undefined,
      notif.repo,
    );
    // Seed a settings row so GET returns a body.
    await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });

    const res = await app.request("/api/settings");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.notificationEmail).toBe("ops@tenant.io");
    expect(body.hasSlackWebhook).toBe(true);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("secret-ct");
    expect(serialized).not.toContain("slackWebhookEncrypted");
  });

  it("PUT without notification fields leaves them untouched", async () => {
    const notif = makeNotificationRepo({
      notificationEmail: "keep@tenant.io",
      slackWebhookEncrypted: { ct: "keep-ct", iv: "iv", tag: "tag" },
    });
    const app = buildNotifApp(notif);

    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });

    expect(res.status).toBe(200);
    expect(notif.repo.update).not.toHaveBeenCalled();
    expect(notif.store.current.notificationEmail).toBe("keep@tenant.io");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.notificationEmail).toBe("keep@tenant.io");
    expect(body.hasSlackWebhook).toBe(true);
  });

  it("PUT with nulls clears both channels", async () => {
    const notif = makeNotificationRepo({
      notificationEmail: "old@tenant.io",
      slackWebhookEncrypted: { ct: "old-ct", iv: "iv", tag: "tag" },
    });
    const cipher = makeCipher();
    const app = buildNotifApp(notif, cipher);

    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        notificationEmail: null,
        slackWebhookUrl: null,
      }),
    });

    expect(res.status).toBe(200);
    expect(cipher.encrypt).not.toHaveBeenCalled();
    expect(notif.store.current.notificationEmail).toBeNull();
    expect(notif.store.current.slackWebhookEncrypted).toBeNull();
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.notificationEmail).toBeNull();
    expect(body.hasSlackWebhook).toBe(false);
  });

  it("rejects an invalid notificationEmail", async () => {
    const app = buildNotifApp(makeNotificationRepo());
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, notificationEmail: "not-an-email" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid slackWebhookUrl", async () => {
    const app = buildNotifApp(makeNotificationRepo());
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, slackWebhookUrl: "not-a-url" }),
    });
    expect(res.status).toBe(400);
  });
});

function buildFeaturesApp(
  features: ReturnType<typeof makeFeaturesRepo>,
  repo: UserSettingsRepo = makeRepo(null).repo,
) {
  return buildApp(
    repo,
    makeQueue(),
    undefined,
    makeSourcesSync(),
    undefined,
    undefined,
    undefined,
    undefined,
    features.repo,
  );
}

describe("feature toggles (REQ-093)", () => {
  it("test_REQ_093_feature_flags_default_off_independent: GET reports all three off by default", async () => {
    const features = makeFeaturesRepo();
    const app = buildFeaturesApp(features);
    await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });

    const res = await app.request("/api/settings");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.canonEnabled).toBe(false);
    expect(body.deliverabilityEnabled).toBe(false);
    expect(body.evalEnabled).toBe(false);
  });

  it("PUT persists each toggle independently on the tenants accessor", async () => {
    const features = makeFeaturesRepo();
    const app = buildFeaturesApp(features);

    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, canonEnabled: true }),
    });
    expect(res.status).toBe(200);
    expect(features.store.current).toEqual({
      canonEnabled: true,
      deliverabilityEnabled: false,
      evalEnabled: false,
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.canonEnabled).toBe(true);
    expect(body.evalEnabled).toBe(false);

    const res2 = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, evalEnabled: true }),
    });
    expect(res2.status).toBe(200);
    // canonEnabled stays on: toggles are independent and omitted ones untouched.
    expect(features.store.current).toEqual({
      canonEnabled: true,
      deliverabilityEnabled: false,
      evalEnabled: true,
    });
  });

  it("PUT without toggle fields never calls update", async () => {
    const features = makeFeaturesRepo();
    const app = buildFeaturesApp(features);
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(200);
    expect(features.repo.update).not.toHaveBeenCalled();
  });

  it("rejects non-boolean toggle values", async () => {
    const features = makeFeaturesRepo();
    const app = buildFeaturesApp(features);
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, canonEnabled: "yes" }),
    });
    expect(res.status).toBe(400);
    expect(features.repo.update).not.toHaveBeenCalled();
  });
});

describe("shortlist size is not tenant-settable (REQ-094)", () => {
  it("PUT ignores a client-sent shortlistSize and applies the internal default on new rows", async () => {
    const { repo } = makeRepo(null);
    const upsertSpy = vi.spyOn(repo, "upsert");
    const app = buildApp(repo, makeQueue());
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, shortlistSize: 99 }),
    });
    expect(res.status).toBe(200);
    expect(upsertSpy.mock.calls[0][0].shortlistSize).toBe(30);
  });

  it("PUT preserves the existing DB value (tenant 0 keeps its tuned size)", async () => {
    const existing = {
      id: "id-1",
      topN: 5,
      halfLifeHours: null,
      hnEnabled: true,
      hnConfig: { sinceDays: 1 },
      redditEnabled: false,
      redditConfig: null,
      webEnabled: false,
      webConfig: null,
      twitterEnabled: false,
      twitterConfig: null,
      webSearchEnabled: false,
      webSearchConfig: null,
      posthogEnabled: false,
      posthogProjectToken: null,
      posthogHost: null,
      scheduleTime: "08:00",
      pipelineTime: "08:00",
      emailTime: "08:30",
      linkedinTime: "08:45",
      twitterTime: "09:00",
      scheduleTimezone: "UTC",
      scheduleEnabled: false,
      emailEnabled: true,
      linkedinEnabled: true,
      twitterPostEnabled: true,
      autoReview: false,
      rankingPrompt: "Default ranking prompt",
      shortlistPrompt: "Default shortlist prompt",
      shortlistSize: 55,
      updatedAt: new Date().toISOString(),
    } as UserSettings;
    const { repo } = makeRepo(existing);
    const upsertSpy = vi.spyOn(repo, "upsert");
    const app = buildApp(repo, makeQueue());
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, shortlistSize: 10 }),
    });
    expect(res.status).toBe(200);
    expect(upsertSpy.mock.calls[0][0].shortlistSize).toBe(55);
  });

  it("accepts a body WITHOUT shortlistSize (the field is gone from the tenant UI)", async () => {
    const { repo } = makeRepo(null);
    const app = buildApp(repo, makeQueue());
    const { shortlistSize: _omitted, ...bodyWithout } = validBody;
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyWithout),
    });
    expect(res.status).toBe(200);
  });

  it("GET and PUT responses never serialize shortlistSize", async () => {
    const { repo } = makeRepo(null);
    const app = buildApp(repo, makeQueue());
    const putRes = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    expect(putRes.status).toBe(200);
    const putBody = (await putRes.json()) as Record<string, unknown>;
    expect("shortlistSize" in putBody).toBe(false);

    const getRes = await app.request("/api/settings");
    const getBody = (await getRes.json()) as Record<string, unknown>;
    expect("shortlistSize" in getBody).toBe(false);
  });
});
