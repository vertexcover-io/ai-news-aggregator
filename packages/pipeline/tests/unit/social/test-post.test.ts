import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleSocialTestPostJob, type SocialTestPostDeps } from "@pipeline/social/test-post.js";
import type { SocialTokenRow } from "@pipeline/repositories/social-tokens.js";

const NOW = new Date("2026-05-11T12:00:00.000Z");

function makeRedis() {
  const setex = vi.fn(() => Promise.resolve("OK"));
  return { setex };
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    silent: vi.fn(),
  } as unknown as SocialTestPostDeps["logger"];
}

function makeTokensRepo(linkedinRow: SocialTokenRow | null, twitterRow: SocialTokenRow | null) {
  return {
    withTokenLock: vi.fn(async <T,>(platform: "linkedin" | "twitter", fn: (row: SocialTokenRow | null, tx: { saveToken: (p: string, i: unknown) => Promise<void> }) => Promise<T>): Promise<T> => {
      const row = platform === "linkedin" ? linkedinRow : twitterRow;
      const tx = { saveToken: vi.fn(() => Promise.resolve()) };
      return fn(row, tx);
    }),
  };
}

function linkedinRow(): SocialTokenRow {
  return {
    platform: "linkedin",
    accessToken: "li-access",
    refreshToken: "li-refresh",
    expiresAt: new Date(NOW.getTime() + 3600_000),
    metadata: { personUrn: "urn:li:person:abc" },
    updatedAt: NOW,
  };
}

function twitterRow(): SocialTokenRow {
  return {
    platform: "twitter",
    accessToken: "tw-access",
    refreshToken: "tw-refresh",
    expiresAt: new Date(NOW.getTime() + 3600_000),
    metadata: null,
    updatedAt: NOW,
  };
}

const config: SocialTestPostDeps["config"] = {
  linkedinApiVersion: "202405",
  linkedinClientId: "li-id",
  linkedinClientSecret: "li-secret",
  twitterClientId: "tw-id",
  twitterClientSecret: "tw-secret",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleSocialTestPostJob", () => {
  it("linkedin happy path: writes posted result with permalink", async () => {
    const redis = makeRedis();
    const linkedinApiClient = {
      createPost: vi.fn(() => Promise.resolve({ ok: true as const, postUrn: "urn:li:share:123" })),
    };
    const deps: SocialTestPostDeps = {
      linkedinApiClient,
      twitterApiClient: null,
      tokens: makeTokensRepo(linkedinRow(), null),
      config,
      redis,
      logger: makeLogger(),
      now: () => NOW,
    };
    await handleSocialTestPostJob(deps, { data: { platform: "linkedin", requestId: "req-1" } });
    expect(linkedinApiClient.createPost).toHaveBeenCalledOnce();
    expect(redis.setex).toHaveBeenCalledWith(
      "social-test:req-1",
      300,
      JSON.stringify({ status: "posted", permalink: "urn:li:share:123" }),
    );
  });

  it("linkedin DUPLICATE_POST: writes posted with null permalink", async () => {
    const redis = makeRedis();
    const linkedinApiClient = {
      createPost: vi.fn(() => Promise.resolve({
        ok: false as const,
        status: 422,
        body: '{"errorDetails":{"inputErrors":[{"code":"DUPLICATE_POST"}]}}',
        errorCode: "DUPLICATE_POST",
      })),
    };
    const deps: SocialTestPostDeps = {
      linkedinApiClient,
      twitterApiClient: null,
      tokens: makeTokensRepo(linkedinRow(), null),
      config,
      redis,
      logger: makeLogger(),
      now: () => NOW,
    };
    await handleSocialTestPostJob(deps, { data: { platform: "linkedin", requestId: "req-2" } });
    expect(redis.setex).toHaveBeenCalledWith(
      "social-test:req-2",
      300,
      JSON.stringify({ status: "posted", permalink: null }),
    );
  });

  it("twitter happy path: writes posted with tweet url", async () => {
    const redis = makeRedis();
    const twitterApiClient = {
      createPost: vi.fn(() => Promise.resolve({
        ok: true as const,
        tweetId: "999",
        tweetUrl: "https://x.com/i/status/999",
      })),
    };
    const deps: SocialTestPostDeps = {
      linkedinApiClient: null,
      twitterApiClient,
      tokens: makeTokensRepo(null, twitterRow()),
      config,
      redis,
      logger: makeLogger(),
      now: () => NOW,
    };
    await handleSocialTestPostJob(deps, { data: { platform: "twitter", requestId: "req-3" } });
    expect(redis.setex).toHaveBeenCalledWith(
      "social-test:req-3",
      300,
      JSON.stringify({ status: "posted", permalink: "https://x.com/i/status/999" }),
    );
  });

  it("twitter 401: writes failed with http_401 error", async () => {
    const redis = makeRedis();
    const twitterApiClient = {
      createPost: vi.fn(() => Promise.resolve({
        ok: false as const,
        status: 401,
        body: "unauthorized",
      })),
    };
    const deps: SocialTestPostDeps = {
      linkedinApiClient: null,
      twitterApiClient,
      tokens: makeTokensRepo(null, twitterRow()),
      config,
      redis,
      logger: makeLogger(),
      now: () => NOW,
    };
    await handleSocialTestPostJob(deps, { data: { platform: "twitter", requestId: "req-4" } });
    const call = redis.setex.mock.calls[0];
    expect(call[0]).toBe("social-test:req-4");
    expect(call[1]).toBe(300);
    const parsed = JSON.parse(call[2] as string);
    expect(parsed.status).toBe("failed");
    expect(parsed.error).toMatch(/^http_401:/);
  });

  it("apiClient null: writes failed with not_configured", async () => {
    const redis = makeRedis();
    const deps: SocialTestPostDeps = {
      linkedinApiClient: null,
      twitterApiClient: null,
      tokens: makeTokensRepo(null, null),
      config,
      redis,
      logger: makeLogger(),
      now: () => NOW,
    };
    await handleSocialTestPostJob(deps, { data: { platform: "linkedin", requestId: "req-5" } });
    expect(redis.setex).toHaveBeenCalledWith(
      "social-test:req-5",
      300,
      JSON.stringify({ status: "failed", error: "not_configured" }),
    );
  });
});
