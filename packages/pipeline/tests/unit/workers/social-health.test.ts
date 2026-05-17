import { describe, expect, it, vi } from "vitest";
import type { Logger } from "@newsletter/shared/logger";

import { handleSocialHealthJob } from "@pipeline/workers/social-health.js";
import type { TwitterApiClient } from "@pipeline/social/twitter/types.js";

function makeLogger(): Logger {
  const noop = vi.fn();
  return {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: (): Logger => makeLogger(),
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

describe("handleSocialHealthJob", () => {
  it("noops for non social-health jobs", async () => {
    const client = makeClient({ ok: true });
    await handleSocialHealthJob(
      {
        twitterApiClient: client,
        logger: makeLogger(),
      },
      { name: "daily-run", id: "job-1", data: {} },
    );

    expect(client.validateCredentials).not.toHaveBeenCalled();
  });

  it("validates X credentials and only logs on success", async () => {
    const client = makeClient({ ok: true });
    const fetchFn = vi.fn();
    const logger = makeLogger();

    await handleSocialHealthJob(
      {
        twitterApiClient: client,
        slackWebhookUrl: "https://hooks.slack.com/services/T/B/C",
        fetchFn,
        logger,
      },
      { name: "social-health", id: "job-1", data: {} },
    );

    expect(client.validateCredentials).toHaveBeenCalledOnce();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      { event: "social.twitter.health_ok", jobId: "job-1" },
      "twitter credential health check passed",
    );
  });

  it("logs and sends a Slack alert when X credentials fail", async () => {
    const client = makeClient({
      ok: false,
      status: 403,
      body: '{"title":"Forbidden"}',
    });
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response("ok", { status: 200 }));
    const logger = makeLogger();

    await handleSocialHealthJob(
      {
        twitterApiClient: client,
        slackWebhookUrl: "https://hooks.slack.com/services/T/B/C",
        fetchFn,
        logger,
      },
      { name: "social-health", id: "job-1", data: {} },
    );

    expect(logger.error).toHaveBeenCalledWith(
      {
        event: "social.twitter.health_failed",
        jobId: "job-1",
        status: 403,
      },
      "twitter credential health check failed",
    );
    expect(fetchFn).toHaveBeenCalledOnce();
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    const body = typeof init.body === "string" ? init.body : "";
    expect(body).toContain("X credential health check failed");
    expect(body).toContain("403");
  });

  it("logs skipped when the X posting client is not configured", async () => {
    const logger = makeLogger();

    await handleSocialHealthJob(
      {
        twitterApiClient: null,
        logger,
      },
      { name: "social-health", id: "job-1", data: {} },
    );

    expect(logger.warn).toHaveBeenCalledWith(
      {
        event: "social.twitter.health_skipped",
        reason: "not_configured",
        jobId: "job-1",
      },
      "twitter credential health check skipped",
    );
  });
});
