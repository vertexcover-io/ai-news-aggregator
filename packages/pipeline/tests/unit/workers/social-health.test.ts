import { describe, expect, it, vi } from "vitest";
import { TENANT_ZERO_ID } from "@newsletter/shared/constants";
import type { Logger } from "@newsletter/shared/logger";

import type {
  SocialTokenRow,
  SocialTokensRepo,
} from "@pipeline/repositories/social-tokens.js";
import { checkTenantSocialHealth } from "@pipeline/services/social-health.js";
import type { TwitterApiClient } from "@pipeline/social/twitter/types.js";
import { handleSocialHealthJob } from "@pipeline/workers/social-health.js";

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const NOW = new Date("2026-06-11T12:00:00.000Z");

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

function makeClient(
  result: Awaited<ReturnType<TwitterApiClient["validateCredentials"]>>,
): TwitterApiClient {
  return {
    createPost: vi.fn(),
    validateCredentials: vi.fn().mockResolvedValue(result),
  };
}

function linkedinRow(overrides: Partial<SocialTokenRow> = {}): SocialTokenRow {
  return {
    platform: "linkedin",
    accessToken: "at",
    refreshToken: "rt",
    expiresAt: new Date(NOW.getTime() + 3600 * 1000),
    metadata: null,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeTokens(
  linkedin: SocialTokenRow | null,
): Pick<SocialTokensRepo, "getToken"> {
  return {
    getToken: vi.fn((platform: "linkedin" | "twitter") =>
      Promise.resolve(platform === "linkedin" ? linkedin : null),
    ),
  };
}

describe("checkTenantSocialHealth", () => {
  it("nothing connected → empty report (healthy no-op)", async () => {
    const report = await checkTenantSocialHealth({
      tokens: makeTokens(null),
      twitterClient: null,
      now: () => NOW,
    });
    expect(report).toEqual({ checkedPlatforms: [], issues: [] });
  });

  it("twitter client validating OK + fresh linkedin token → no issues", async () => {
    const report = await checkTenantSocialHealth({
      tokens: makeTokens(linkedinRow()),
      twitterClient: makeClient({ ok: true }),
      now: () => NOW,
    });
    expect(report.checkedPlatforms).toEqual(["twitter", "linkedin"]);
    expect(report.issues).toEqual([]);
  });

  it("twitter validation failure → credentials_invalid issue with status", async () => {
    const report = await checkTenantSocialHealth({
      tokens: makeTokens(null),
      twitterClient: makeClient({ ok: false, status: 403, body: "Forbidden" }),
      now: () => NOW,
    });
    expect(report.issues).toEqual([
      {
        platform: "twitter",
        reason: "credentials_invalid",
        status: 403,
        detail: "Forbidden",
      },
    ]);
  });

  it("expired linkedin token WITHOUT refresh token → token_expired issue", async () => {
    const report = await checkTenantSocialHealth({
      tokens: makeTokens(
        linkedinRow({
          expiresAt: new Date(NOW.getTime() - 1000),
          refreshToken: "",
        }),
      ),
      twitterClient: null,
      now: () => NOW,
    });
    expect(report.issues).toEqual([
      { platform: "linkedin", reason: "token_expired" },
    ]);
  });

  it("expired linkedin token WITH refresh token → healthy (refresh happens at post time)", async () => {
    const report = await checkTenantSocialHealth({
      tokens: makeTokens(
        linkedinRow({ expiresAt: new Date(NOW.getTime() - 1000) }),
      ),
      twitterClient: null,
      now: () => NOW,
    });
    expect(report.issues).toEqual([]);
  });
});

describe("handleSocialHealthJob", () => {
  it("noops for non social-health jobs", async () => {
    const getTwitterClient = vi.fn();
    await handleSocialHealthJob(
      {
        getTwitterClient,
        getTokensRepo: () => makeTokens(null),
        logger: makeLogger(),
      },
      { name: "daily-run", id: "job-1", data: {} },
    );
    expect(getTwitterClient).not.toHaveBeenCalled();
  });

  it("checks the JOB's tenant, not a global credential", async () => {
    const getTwitterClient = vi.fn().mockResolvedValue(null);
    const getTokensRepo = vi.fn().mockReturnValue(makeTokens(null));

    await handleSocialHealthJob(
      {
        getTwitterClient,
        getTokensRepo,
        logger: makeLogger(),
      },
      { name: "social-health", id: "job-1", data: { tenantId: TENANT_A } },
    );

    expect(getTwitterClient).toHaveBeenCalledWith(TENANT_A);
    expect(getTokensRepo).toHaveBeenCalledWith(TENANT_A);
  });

  it("legacy job with no tenantId defaults to tenant 0", async () => {
    const getTwitterClient = vi.fn().mockResolvedValue(null);
    await handleSocialHealthJob(
      {
        getTwitterClient,
        getTokensRepo: () => makeTokens(null),
        logger: makeLogger(),
      },
      { name: "social-health", id: "job-1", data: {} },
    );
    expect(getTwitterClient).toHaveBeenCalledWith(TENANT_ZERO_ID);
  });

  it("tenant with nothing connected → healthy no-op, no slack alert", async () => {
    const fetchFn = vi.fn();
    const logger = makeLogger();

    await handleSocialHealthJob(
      {
        getTwitterClient: () => Promise.resolve(null),
        getTokensRepo: () => makeTokens(null),
        slackWebhookUrl: "https://hooks.slack.com/services/T/B/C",
        fetchFn,
        logger,
      },
      { name: "social-health", id: "job-1", data: { tenantId: TENANT_A } },
    );

    expect(fetchFn).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      {
        event: "social.health_noop",
        reason: "nothing_connected",
        tenantId: TENANT_A,
        jobId: "job-1",
      },
      "social credential health check skipped (nothing connected)",
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("healthy connected tenant → logs ok, no alert", async () => {
    const fetchFn = vi.fn();
    const logger = makeLogger();

    await handleSocialHealthJob(
      {
        getTwitterClient: () => Promise.resolve(makeClient({ ok: true })),
        getTokensRepo: () => makeTokens(null),
        slackWebhookUrl: "https://hooks.slack.com/services/T/B/C",
        fetchFn,
        logger,
      },
      { name: "social-health", id: "job-1", data: { tenantId: TENANT_A } },
    );

    expect(fetchFn).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      {
        event: "social.health_ok",
        tenantId: TENANT_A,
        platforms: ["twitter"],
        jobId: "job-1",
      },
      "social credential health check passed",
    );
  });

  it("failing twitter credentials → logs error and sends a tenant-tagged Slack alert", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response("ok", { status: 200 }));
    const logger = makeLogger();

    await handleSocialHealthJob(
      {
        getTwitterClient: () =>
          Promise.resolve(
            makeClient({ ok: false, status: 403, body: '{"title":"Forbidden"}' }),
          ),
        getTokensRepo: () => makeTokens(null),
        slackWebhookUrl: "https://hooks.slack.com/services/T/B/C",
        fetchFn,
        logger,
      },
      { name: "social-health", id: "job-1", data: { tenantId: TENANT_A } },
    );

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "social.health_failed",
        tenantId: TENANT_A,
      }),
      "social credential health check failed",
    );
    expect(fetchFn).toHaveBeenCalledOnce();
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    const body = typeof init.body === "string" ? init.body : "";
    expect(body).toContain("Social credential health check failed");
    expect(body).toContain(TENANT_A);
    expect(body).toContain("403");
  });

  it("issues without a webhook URL → logs error, no fetch", async () => {
    const fetchFn = vi.fn();
    const logger = makeLogger();

    await handleSocialHealthJob(
      {
        getTwitterClient: () =>
          Promise.resolve(makeClient({ ok: false, status: 401, body: "nope" })),
        getTokensRepo: () => makeTokens(null),
        fetchFn,
        logger,
      },
      { name: "social-health", id: "job-1", data: { tenantId: TENANT_A } },
    );

    expect(logger.error).toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("slack post failure → logged, not thrown", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response("bad", { status: 500 }));
    const logger = makeLogger();

    await handleSocialHealthJob(
      {
        getTwitterClient: () =>
          Promise.resolve(makeClient({ ok: false, status: 401, body: "nope" })),
        getTokensRepo: () => makeTokens(null),
        slackWebhookUrl: "https://hooks.slack.com/services/T/B/C",
        fetchFn,
        logger,
      },
      { name: "social-health", id: "job-1", data: { tenantId: TENANT_A } },
    );

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: "social.health_slack_failed" }),
      "social credential health slack alert failed",
    );
  });
});
