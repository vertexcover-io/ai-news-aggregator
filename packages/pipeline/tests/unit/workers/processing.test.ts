import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLoggerInfo = vi.fn();
const mockLoggerWarn = vi.fn();
const mockLoggerError = vi.fn();

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation((name, handler, opts) => ({
    name,
    handler,
    options: opts,
    close: vi.fn(),
    on: vi.fn(),
  })),
  Queue: vi.fn().mockImplementation((name, opts) => ({
    name,
    options: opts,
    add: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock("@newsletter/shared/redis", () => ({
  createRedisConnection: vi.fn(() => ({ fake: "redis" })),
}));

vi.mock("@newsletter/shared/logger", () => ({
  createLogger: vi.fn(() => ({
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
  })),
}));

const mockHandleRunProcessJob = vi.fn();
vi.mock("@pipeline/workers/run-process.js", () => ({
  handleRunProcessJob: (...args: unknown[]) => mockHandleRunProcessJob(...args),
}));

const mockHandleDailyRunJob = vi.fn();
vi.mock("@pipeline/workers/daily-run.js", () => ({
  handleDailyRunJob: (...args: unknown[]) => mockHandleDailyRunJob(...args),
}));

const mockHandleSocialHealthJob = vi.fn();
vi.mock("@pipeline/workers/social-health.js", () => ({
  handleSocialHealthJob: (...args: unknown[]) => mockHandleSocialHealthJob(...args),
}));

const mockHandleLinkedInPostJob = vi.fn();
vi.mock("@pipeline/workers/linkedin-post.js", () => ({
  handleLinkedInPostJob: (...args: unknown[]) => mockHandleLinkedInPostJob(...args),
}));

const mockHandleTwitterPostJob = vi.fn();
vi.mock("@pipeline/workers/twitter-post.js", () => ({
  handleTwitterPostJob: (...args: unknown[]) => mockHandleTwitterPostJob(...args),
}));

const mockHandleEmailSendJob = vi.fn();
vi.mock("@pipeline/workers/email-send.js", () => ({
  handleEmailSendJob: (...args: unknown[]) => mockHandleEmailSendJob(...args),
}));

const mockCreateLinkedInNotifier = vi.fn(() => ({
  notifyArchiveReady: vi.fn(),
}));
const mockCreateTwitterNotifier = vi.fn(() => ({
  notifyArchiveReady: vi.fn(),
}));
vi.mock("@pipeline/social/linkedin/notifier.js", () => ({
  createLinkedInNotifier: (...args: unknown[]) =>
    mockCreateLinkedInNotifier(...(args as [])),
}));
vi.mock("@pipeline/social/twitter/notifier.js", () => ({
  createTwitterNotifier: (...args: unknown[]) =>
    mockCreateTwitterNotifier(...(args as [])),
}));
vi.mock("@pipeline/social/linkedin/api-client.js", () => ({
  createLinkedInApiClient: vi.fn(() => ({ fake: "linkedin-client" })),
}));
vi.mock("@pipeline/social/twitter/api-client.js", () => ({
  createTwitterApiClient: vi.fn(() => ({ fake: "twitter-client" })),
}));
vi.mock("@pipeline/repositories/social-tokens.js", () => ({
  createSocialTokensRepo: vi.fn(() => ({ fake: "social-tokens" })),
}));
vi.mock("@pipeline/repositories/social-credentials.js", () => ({
  createSocialCredentialsRepo: vi.fn(() => ({
    getTwitter: vi.fn().mockResolvedValue(null),
    upsertTwitter: vi.fn(),
    delete: vi.fn(),
  })),
}));
// App-level store (P12): LinkedIn client + collector cookie resolve here; the
// env-fallback paths under test need the DB store to report "no row".
vi.mock("@pipeline/repositories/app-credentials.js", () => ({
  createAppCredentialsRepo: vi.fn(() => ({
    getLinkedInClient: vi.fn().mockResolvedValue(null),
    getTwitterCollector: vi.fn().mockResolvedValue(null),
    getTwitterClient: vi.fn().mockResolvedValue(null),
    upsertTwitterCollector: vi.fn(),
  })),
}));
vi.mock("@newsletter/shared/services/credential-cipher", () => ({
  getCredentialCipher: vi.fn(() => ({
    encrypt: vi.fn(),
    decrypt: vi.fn(),
  })),
}));
vi.mock("@pipeline/repositories/run-archives.js", () => ({
  createRunArchivesRepo: vi.fn(() => ({
    findById: vi.fn(),
    upsert: vi.fn(),
    markLinkedInPosted: vi.fn(),
    markTwitterPosted: vi.fn(),
    recordSocialFailure: vi.fn(),
  })),
}));
vi.mock("@pipeline/repositories/raw-items.js", () => ({
  createRawItemsRepo: vi.fn(() => ({ findByIds: vi.fn() })),
}));
vi.mock("@pipeline/repositories/subscribers.js", () => ({
  createPipelineSubscribersRepo: vi.fn(() => ({ listConfirmed: vi.fn(), findByIds: vi.fn() })),
}));
vi.mock("@pipeline/repositories/email-sends.js", () => ({
  createPipelineEmailSendsRepo: vi.fn(() => ({ create: vi.fn(), findSentSubscriberIds: vi.fn() })),
}));
vi.mock("@pipeline/repositories/candidates.js", () => ({
  createCandidatesRepo: vi.fn(() => ({})),
}));
vi.mock("@pipeline/repositories/user-settings.js", () => ({
  createUserSettingsRepo: vi.fn(() => ({})),
}));
// Single-tenant bridge: unit tests run "legacy unscoped" — the fake db has no
// .select, so the prime/lookup must be stubbed out (scope = undefined).
// jobTenantContext stays REAL (pure, no DB) so P9 per-job scoping behaves as
// in production.
vi.mock("@pipeline/repositories/default-tenant.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@pipeline/repositories/default-tenant.js")
  >();
  return {
    ...actual,
    getDefaultTenantScope: vi.fn(() => undefined),
    primeDefaultTenantScope: vi.fn(() => Promise.resolve(undefined)),
  };
});
vi.mock("@pipeline/services/run-state.js", () => ({
  createRunStateService: vi.fn(() => ({})),
}));
vi.mock("@pipeline/services/cancel-subscriber.js", () => ({
  createCancelSubscriber: vi.fn(() => ({})),
}));
vi.mock("@pipeline/lib/email-render.js", () => ({
  renderNewsletter: vi.fn(),
}));
vi.mock("@pipeline/lib/email-provider.js", () => ({
  createEmailProvider: vi.fn(() => ({ send: vi.fn() })),
  createSmtpProvider: vi.fn(() => ({ send: vi.fn() })),
}));
vi.mock("@newsletter/shared", async () => {
  const actual = await vi.importActual("@newsletter/shared");
  return {
    ...actual,
    getDb: vi.fn(() => ({ fake: "db" })),
    createSlackNotifier: vi.fn(() => ({ notifyNewsletterSent: vi.fn() })),
  };
});

const { createProcessingWorker, buildDefaultNewsletterSendDeps } = await import(
  "@pipeline/workers/processing.js"
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createProcessingWorker (single dispatcher Worker on 'processing' queue)", () => {
  function makeWorker(): { handler: (job: unknown) => Promise<unknown> } {
    const w = createProcessingWorker({
      runProcessDeps: { fake: "rp-deps" } as never,
      dailyRunDeps: { fake: "dr-deps" } as never,
      connection: { fake: "redis" } as never,
      // no-op semaphore: the fake connection cannot eval Lua
      runConcurrencyLimiter: {
        acquire: () => Promise.resolve(() => Promise.resolve()),
        inUse: () => Promise.resolve(0),
      },
    });
    return w as unknown as { handler: (job: unknown) => Promise<unknown> };
  }

  it("routes job.name === 'run-process' to handleRunProcessJob", async () => {
    mockHandleRunProcessJob.mockResolvedValue({ rankedCount: 5 });
    const worker = makeWorker();
    const job = { name: "run-process", id: "j1", data: { runId: "r1" } };
    const result = await worker.handler(job);
    expect(mockHandleRunProcessJob).toHaveBeenCalledOnce();
    expect(mockHandleDailyRunJob).not.toHaveBeenCalled();
    expect(result).toEqual({ rankedCount: 5 });
  });

  it("routes job.name === 'daily-run' to handleDailyRunJob", async () => {
    mockHandleDailyRunJob.mockResolvedValue(undefined);
    const worker = makeWorker();
    const job = { name: "daily-run", id: "j2", data: {} };
    await worker.handler(job);
    expect(mockHandleDailyRunJob).toHaveBeenCalledOnce();
    expect(mockHandleRunProcessJob).not.toHaveBeenCalled();
  });

  it("routes job.name === 'social-health' to handleSocialHealthJob", async () => {
    mockHandleSocialHealthJob.mockResolvedValue(undefined);
    const worker = makeWorker();
    const job = { name: "social-health", id: "j-health", data: {} };
    await worker.handler(job);
    expect(mockHandleSocialHealthJob).toHaveBeenCalledOnce();
    expect(mockHandleDailyRunJob).not.toHaveBeenCalled();
    expect(mockHandleRunProcessJob).not.toHaveBeenCalled();
  });

  // P10 (REQ-065): run-process jobs go through the global Redis semaphore —
  // a slot is acquired (waiting if the cap is saturated) before the run
  // executes and released afterwards, success or failure.
  describe("global run-concurrency cap wiring", () => {
    function makeCappedWorker(): {
      handler: (job: unknown) => Promise<unknown>;
      acquire: ReturnType<typeof vi.fn>;
      release: ReturnType<typeof vi.fn>;
      order: string[];
    } {
      const order: string[] = [];
      const release = vi.fn(() => {
        order.push("release");
        return Promise.resolve();
      });
      const acquire = vi.fn((holderId: string) => {
        order.push(`acquire:${holderId}`);
        return Promise.resolve(release);
      });
      const w = createProcessingWorker({
        runProcessDeps: { fake: "rp-deps" } as never,
        dailyRunDeps: { fake: "dr-deps" } as never,
        connection: { fake: "redis" } as never,
        runConcurrencyLimiter: { acquire, inUse: vi.fn() } as never,
      });
      return {
        ...(w as unknown as { handler: (job: unknown) => Promise<unknown> }),
        acquire,
        release,
        order,
      };
    }

    it("test_REQ_065_run_process_waits_for_a_slot_then_releases", async () => {
      mockHandleRunProcessJob.mockImplementation(() => Promise.resolve({ rankedCount: 1 }));
      const worker = makeCappedWorker();

      await worker.handler({ name: "run-process", id: "j1", data: { runId: "r-cap" } });

      expect(worker.acquire).toHaveBeenCalledWith("r-cap");
      expect(worker.order[0]).toBe("acquire:r-cap");
      expect(worker.order.at(-1)).toBe("release");
      expect(mockHandleRunProcessJob).toHaveBeenCalledOnce();
    });

    it("releases the slot even when the run fails", async () => {
      mockHandleRunProcessJob.mockRejectedValue(new Error("run exploded"));
      const worker = makeCappedWorker();

      await expect(
        worker.handler({ name: "run-process", id: "j2", data: { runId: "r-boom" } }),
      ).rejects.toThrow("run exploded");

      expect(worker.release).toHaveBeenCalledOnce();
    });

    it("does not gate non-run job types on the run semaphore", async () => {
      mockHandleDailyRunJob.mockResolvedValue(undefined);
      const worker = makeCappedWorker();

      await worker.handler({ name: "daily-run", id: "j3", data: {} });

      expect(worker.acquire).not.toHaveBeenCalled();
    });

    it("sets worker concurrency above the run cap so capped runs parallelize", async () => {
      const { PROCESSING_WORKER_CONCURRENCY, MAX_CONCURRENT_RUNS } = await import(
        "@pipeline/services/concurrency.js"
      );
      const w = createProcessingWorker({
        runProcessDeps: { fake: "rp-deps" } as never,
        dailyRunDeps: { fake: "dr-deps" } as never,
        connection: { fake: "redis" } as never,
      }) as unknown as { options: { concurrency?: number } };

      expect(w.options.concurrency).toBe(PROCESSING_WORKER_CONCURRENCY);
      expect(PROCESSING_WORKER_CONCURRENCY).toBeGreaterThan(MAX_CONCURRENT_RUNS);
    });
  });

  describe("buildDefaultNewsletterSendDeps env-var construction", () => {
    const originalEnv = { ...process.env };
    beforeEach(() => {
      process.env = { ...originalEnv };
      delete process.env.LINKEDIN_CLIENT_ID;
      delete process.env.LINKEDIN_CLIENT_SECRET;
      delete process.env.TWITTER_CLIENT_ID;
      delete process.env.TWITTER_CLIENT_SECRET;
      delete process.env.TWITTER_API_KEY;
      delete process.env.TWITTER_API_SECRET;
      delete process.env.TWITTER_ACCESS_TOKEN;
      delete process.env.TWITTER_ACCESS_TOKEN_SECRET;
    });

    it("constructs linkedinNotifier when LINKEDIN_CLIENT_ID + SECRET set; null otherwise", async () => {
      const depsWithout = await buildDefaultNewsletterSendDeps();
      expect(depsWithout.linkedinNotifier).toBeNull();

      process.env.LINKEDIN_CLIENT_ID = "li-id";
      process.env.LINKEDIN_CLIENT_SECRET = "li-secret";
      const depsWith = await buildDefaultNewsletterSendDeps();
      expect(depsWith.linkedinNotifier).not.toBeNull();
      expect(mockCreateLinkedInNotifier).toHaveBeenCalled();
    });

    it("constructs twitterNotifier when all OAuth1 credentials are set; null otherwise", async () => {
      const depsWithout = await buildDefaultNewsletterSendDeps();
      expect(depsWithout.twitterNotifier).toBeNull();

      process.env.TWITTER_API_KEY = "tw-api-key";
      process.env.TWITTER_API_SECRET = "tw-api-secret";
      process.env.TWITTER_ACCESS_TOKEN = "tw-access-token";
      process.env.TWITTER_ACCESS_TOKEN_SECRET = "tw-access-secret";
      const depsWith = await buildDefaultNewsletterSendDeps();
      expect(depsWith.twitterNotifier).not.toBeNull();
      expect(mockCreateTwitterNotifier).toHaveBeenCalled();
    });

    it("returns twitterNotifier=null and logs missing key names when OAuth1 config is partial", async () => {
      process.env.TWITTER_API_KEY = "tw-api-key";
      process.env.TWITTER_ACCESS_TOKEN = "tw-access-token";

      const deps = await buildDefaultNewsletterSendDeps();

      expect(deps.twitterNotifier).toBeNull();
      expect(mockCreateTwitterNotifier).not.toHaveBeenCalled();
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        {
          event: "social.twitter.invalid_config",
          missing: ["TWITTER_API_SECRET", "TWITTER_ACCESS_TOKEN_SECRET"],
        },
        "twitter notifier disabled: incomplete OAuth1 configuration",
      );
    });

    it("returns linkedinNotifier=null when only LINKEDIN_CLIENT_ID is set (missing secret)", async () => {
      process.env.LINKEDIN_CLIENT_ID = "li-id";
      const deps = await buildDefaultNewsletterSendDeps();
      expect(deps.linkedinNotifier).toBeNull();
    });
  });

  it("rebuilds publishDeps per job so saved credentials hot-reload without restart (VER-admin-social-config §4.4)", async () => {
    // Track credential snapshots seen by the notifier factory across jobs.
    const linkedinCallArgs: unknown[] = [];
    mockCreateLinkedInNotifier.mockImplementation((args: unknown) => {
      linkedinCallArgs.push(args);
      return { notifyArchiveReady: vi.fn() };
    });

    // First job: no DB row, env-only config.
    process.env.LINKEDIN_CLIENT_ID = "li-id-v1";
    process.env.LINKEDIN_CLIENT_SECRET = "li-secret-v1";

    const worker = createProcessingWorker({
      runProcessDeps: { fake: "rp-deps" } as never,
      dailyRunDeps: { fake: "dr-deps" } as never,
      connection: { fake: "redis" } as never,
    }) as unknown as { handler: (job: unknown) => Promise<unknown> };

    await worker.handler({ name: "linkedin-post", id: "j-a", data: { runId: "r1" } });

    // Operator rotates the credential between jobs (simulates a UI save that
    // changes the env-resolved value; the DB path is covered by the resolver's
    // own tests).
    process.env.LINKEDIN_CLIENT_ID = "li-id-v2";
    process.env.LINKEDIN_CLIENT_SECRET = "li-secret-v2";

    await worker.handler({ name: "linkedin-post", id: "j-b", data: { runId: "r2" } });

    expect(mockCreateLinkedInNotifier).toHaveBeenCalledTimes(2);
    // Same notifier factory args object reused === credentials are cached
    // (the regression). Two distinct calls with two distinct configs === hot
    // reload works.
    const cfg1 = (linkedinCallArgs[0] as { config: { clientId: string } }).config;
    const cfg2 = (linkedinCallArgs[1] as { config: { clientId: string } }).config;
    expect(cfg1.clientId).toBe("li-id-v1");
    expect(cfg2.clientId).toBe("li-id-v2");
  });

  it("logs a warn and returns undefined for unknown job names", async () => {
    const worker = makeWorker();
    const job = { name: "unknown-job", id: "j3", data: {} };
    const result = await worker.handler(job);
    expect(mockHandleRunProcessJob).not.toHaveBeenCalled();
    expect(mockHandleDailyRunJob).not.toHaveBeenCalled();
    expect(mockLoggerWarn).toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  // REQ-014: no two email-send jobs burst past the rate limit — guaranteed by
  // the shared module-scope pacer in email-send.ts (all invocations in the same
  // process share one token-bucket instance). Worker-level concurrency: 1 is NOT
  // set because it would stall all other job types (run-process, linkedin-post,
  // twitter-post) behind a long-running email-send. The pacer alone is sufficient.
  it("REQ-014: worker does not restrict concurrency (shared pacer is the rate guard)", () => {
    const workerInstance = createProcessingWorker({
      runProcessDeps: { fake: "rp-deps" } as never,
      dailyRunDeps: { fake: "dr-deps" } as never,
      connection: { fake: "redis" } as never,
    }) as unknown as { opts?: Record<string, unknown> };

    // concurrency: 1 must NOT be set — it would serialize all job types behind
    // a long-running run-process, delaying email delivery and social posts.
    expect(workerInstance.opts?.concurrency).not.toBe(1);
  });
});
