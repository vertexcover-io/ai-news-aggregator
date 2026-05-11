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

  describe("buildDefaultNewsletterSendDeps env-var construction", () => {
    const originalEnv = { ...process.env };
    beforeEach(() => {
      process.env = { ...originalEnv };
      delete process.env.LINKEDIN_CLIENT_ID;
      delete process.env.LINKEDIN_CLIENT_SECRET;
      delete process.env.TWITTER_CLIENT_ID;
      delete process.env.TWITTER_CLIENT_SECRET;
    });

    it("constructs linkedinNotifier when LINKEDIN_CLIENT_ID + SECRET set; null otherwise", () => {
      const depsWithout = buildDefaultNewsletterSendDeps();
      expect(depsWithout.linkedinNotifier).toBeNull();

      process.env.LINKEDIN_CLIENT_ID = "li-id";
      process.env.LINKEDIN_CLIENT_SECRET = "li-secret";
      const depsWith = buildDefaultNewsletterSendDeps();
      expect(depsWith.linkedinNotifier).not.toBeNull();
      expect(mockCreateLinkedInNotifier).toHaveBeenCalled();
    });

    it("constructs twitterNotifier when TWITTER_CLIENT_ID + SECRET set; null otherwise", () => {
      const depsWithout = buildDefaultNewsletterSendDeps();
      expect(depsWithout.twitterNotifier).toBeNull();

      process.env.TWITTER_CLIENT_ID = "tw-id";
      process.env.TWITTER_CLIENT_SECRET = "tw-secret";
      const depsWith = buildDefaultNewsletterSendDeps();
      expect(depsWith.twitterNotifier).not.toBeNull();
      expect(mockCreateTwitterNotifier).toHaveBeenCalled();
    });

    it("returns linkedinNotifier=null when only LINKEDIN_CLIENT_ID is set (missing secret)", () => {
      process.env.LINKEDIN_CLIENT_ID = "li-id";
      const deps = buildDefaultNewsletterSendDeps();
      expect(deps.linkedinNotifier).toBeNull();
    });
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
});
