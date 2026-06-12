/**
 * Two-tier credential resolution (P12, REQ-082/086 + D-051 DB-first):
 *
 *  - APP-LEVEL secrets — LinkedIn OAuth client (id/secret) and the shared
 *    Twitter collector cookie — resolve from the super-admin `app_credentials`
 *    store first, env fallback. Tenants can never write these.
 *  - TENANT-LEVEL secrets — Twitter OAuth1 posting keys — resolve from the
 *    tenant-scoped `social_credentials` repo keyed (tenant_id, platform).
 */
import { describe, it, expect, vi } from "vitest";
import {
  resolveLinkedInCredentials,
  resolveTwitterCollectorCookie,
  resolveTwitterOAuth1Credentials,
  resolveTwitterOAuth2Client,
} from "@pipeline/services/credential-resolver.js";
import type { SocialCredentialsRepo } from "@pipeline/repositories/social-credentials.js";
import type { AppCredentialsRepo } from "@pipeline/repositories/app-credentials.js";

function makeTenantRepo(opts: {
  twitter?: Awaited<ReturnType<SocialCredentialsRepo["getTwitter"]>>;
  twitterThrows?: Error;
}): SocialCredentialsRepo {
  return {
    getTwitter: vi.fn(() => {
      if (opts.twitterThrows) return Promise.reject(opts.twitterThrows);
      return Promise.resolve(opts.twitter ?? null);
    }),
    upsertTwitter: vi.fn(),
    delete: vi.fn(),
  };
}

function makeAppRepo(opts: {
  linkedinClient?: Awaited<ReturnType<AppCredentialsRepo["getLinkedInClient"]>>;
  linkedinThrows?: Error;
  twitterCollector?: Awaited<ReturnType<AppCredentialsRepo["getTwitterCollector"]>>;
  twitterCollectorThrows?: Error;
  twitterClient?: Awaited<ReturnType<AppCredentialsRepo["getTwitterClient"]>>;
  twitterClientThrows?: Error;
}): AppCredentialsRepo {
  return {
    getLinkedInClient: vi.fn(() => {
      if (opts.linkedinThrows) return Promise.reject(opts.linkedinThrows);
      return Promise.resolve(opts.linkedinClient ?? null);
    }),
    getTwitterCollector: vi.fn(() => {
      if (opts.twitterCollectorThrows) {
        return Promise.reject(opts.twitterCollectorThrows);
      }
      return Promise.resolve(opts.twitterCollector ?? null);
    }),
    getTwitterClient: vi.fn(() => {
      if (opts.twitterClientThrows) {
        return Promise.reject(opts.twitterClientThrows);
      }
      return Promise.resolve(opts.twitterClient ?? null);
    }),
    upsertTwitterCollector: vi.fn(),
  };
}

describe("resolveLinkedInCredentials (app-level store beats env)", () => {
  it("returns app_credentials values when the store row exists, even if env is set", async () => {
    const appRepo = makeAppRepo({
      linkedinClient: {
        clientId: "db-id",
        clientSecret: "db-secret",
        apiVersion: "202510",
        updatedAt: new Date(),
      },
    });
    const env: NodeJS.ProcessEnv = {
      LINKEDIN_CLIENT_ID: "env-id",
      LINKEDIN_CLIENT_SECRET: "env-secret",
      LINKEDIN_API_VERSION: "202501",
    };
    const result = await resolveLinkedInCredentials({ appRepo, env });
    expect(result).toEqual({
      clientId: "db-id",
      clientSecret: "db-secret",
      apiVersion: "202510",
    });
  });

  it("defaults apiVersion to 202511 when the store row has apiVersion=null", async () => {
    const appRepo = makeAppRepo({
      linkedinClient: {
        clientId: "db-id",
        clientSecret: "db-secret",
        apiVersion: null,
        updatedAt: new Date(),
      },
    });
    const result = await resolveLinkedInCredentials({ appRepo, env: {} });
    expect(result).toEqual({
      clientId: "db-id",
      clientSecret: "db-secret",
      apiVersion: "202511",
    });
  });
});

describe("resolveLinkedInCredentials (env fallback)", () => {
  it.each([
    {
      name: "falls back to env (default apiVersion) when the store returns null",
      env: { LINKEDIN_CLIENT_ID: "env-id", LINKEDIN_CLIENT_SECRET: "env-secret" },
      expected: { clientId: "env-id", clientSecret: "env-secret", apiVersion: "202511" },
    },
    {
      name: "uses LINKEDIN_API_VERSION from env when present",
      env: { LINKEDIN_CLIENT_ID: "env-id", LINKEDIN_CLIENT_SECRET: "env-secret", LINKEDIN_API_VERSION: "999999" },
      expected: { clientId: "env-id", clientSecret: "env-secret", apiVersion: "999999" },
    },
  ])("$name", async ({ env, expected }) => {
    const appRepo = makeAppRepo({ linkedinClient: null });
    const result = await resolveLinkedInCredentials({ appRepo, env });
    expect(result).toEqual(expected);
  });
});

describe("resolveLinkedInCredentials (both empty / partial → null)", () => {
  it.each<{ name: string; env: NodeJS.ProcessEnv }>([
    { name: "store null and env has nothing", env: {} },
    { name: "only LINKEDIN_CLIENT_ID set in env", env: { LINKEDIN_CLIENT_ID: "id-only" } },
    { name: "secret is empty string in env", env: { LINKEDIN_CLIENT_ID: "id", LINKEDIN_CLIENT_SECRET: "" } },
  ])("returns null when $name", async ({ env }) => {
    const appRepo = makeAppRepo({ linkedinClient: null });
    expect(await resolveLinkedInCredentials({ appRepo, env })).toBeNull();
  });
});

describe("resolveLinkedInCredentials — store read failure is non-fatal (Edge cases D1/D2)", () => {
  it("returns null and does NOT fall through to env when getLinkedInClient() throws (decrypt failure)", async () => {
    const appRepo = makeAppRepo({
      linkedinThrows: new Error("Unsupported state or unable to authenticate data"),
    });
    // Env IS set — but per spec, a decrypt failure on a present DB row must
    // skip the platform, NOT silently fall through to env (which would mask
    // a legitimate admin-saved row with stale env values).
    const env: NodeJS.ProcessEnv = {
      LINKEDIN_CLIENT_ID: "env-id-should-not-shadow",
      LINKEDIN_CLIENT_SECRET: "env-secret",
      LINKEDIN_API_VERSION: "202511",
    };
    const result = await resolveLinkedInCredentials({ appRepo, env });
    expect(result).toBeNull();
    expect(appRepo.getLinkedInClient).toHaveBeenCalledTimes(1);
  });

  it("returns null when getLinkedInClient() throws even with no env", async () => {
    const appRepo = makeAppRepo({
      linkedinThrows: new TypeError("first argument must be of type string or an instance of Buffer"),
    });
    expect(await resolveLinkedInCredentials({ appRepo, env: {} })).toBeNull();
  });
});

describe("resolveTwitterOAuth1Credentials (tenant-scoped, DB beats env)", () => {
  it("returns DB values when the tenant's row exists", async () => {
    const repo = makeTenantRepo({
      twitter: {
        apiKey: "db-key",
        apiSecret: "db-secret",
        accessToken: "db-at",
        accessTokenSecret: "db-ats",
        updatedAt: new Date(),
      },
    });
    const env: NodeJS.ProcessEnv = {
      TWITTER_API_KEY: "env-key",
      TWITTER_API_SECRET: "env-secret",
      TWITTER_ACCESS_TOKEN: "env-at",
      TWITTER_ACCESS_TOKEN_SECRET: "env-ats",
    };
    const result = await resolveTwitterOAuth1Credentials({ repo, env });
    expect(result).toEqual({
      appKey: "db-key",
      appSecret: "db-secret",
      accessToken: "db-at",
      accessSecret: "db-ats",
    });
  });
});

describe("resolveTwitterOAuth1Credentials (env fallback)", () => {
  it("falls back to env when DB returns null and all 4 env keys are set", async () => {
    const repo = makeTenantRepo({ twitter: null });
    const env: NodeJS.ProcessEnv = {
      TWITTER_API_KEY: "k",
      TWITTER_API_SECRET: "s",
      TWITTER_ACCESS_TOKEN: "t",
      TWITTER_ACCESS_TOKEN_SECRET: "ts",
    };
    const result = await resolveTwitterOAuth1Credentials({ repo, env });
    expect(result).toEqual({
      appKey: "k",
      appSecret: "s",
      accessToken: "t",
      accessSecret: "ts",
    });
  });
});

describe("resolveTwitterOAuth1Credentials (both empty / partial → null)", () => {
  it.each<{ name: string; env: NodeJS.ProcessEnv }>([
    { name: "DB null and env empty", env: {} },
    {
      name: "only 3 of 4 Twitter env keys are present",
      env: {
        TWITTER_API_KEY: "k",
        TWITTER_API_SECRET: "s",
        TWITTER_ACCESS_TOKEN: "t",
        // TWITTER_ACCESS_TOKEN_SECRET intentionally missing
      },
    },
    {
      name: "one of the 4 keys is empty string",
      env: {
        TWITTER_API_KEY: "k",
        TWITTER_API_SECRET: "s",
        TWITTER_ACCESS_TOKEN: "t",
        TWITTER_ACCESS_TOKEN_SECRET: "",
      },
    },
  ])("returns null when $name", async ({ env }) => {
    const repo = makeTenantRepo({ twitter: null });
    expect(await resolveTwitterOAuth1Credentials({ repo, env })).toBeNull();
  });
});

describe("resolveTwitterOAuth1Credentials — DB read failure is non-fatal (Edge cases D1/D2)", () => {
  it("returns null and does NOT throw when repo.getTwitter() throws (decrypt failure)", async () => {
    const repo = makeTenantRepo({
      twitterThrows: new Error("Unsupported state or unable to authenticate data"),
    });
    const env: NodeJS.ProcessEnv = {
      TWITTER_API_KEY: "env-k-should-not-shadow",
      TWITTER_API_SECRET: "env-s",
      TWITTER_ACCESS_TOKEN: "env-t",
      TWITTER_ACCESS_TOKEN_SECRET: "env-ts",
    };
    const result = await resolveTwitterOAuth1Credentials({ repo, env });
    expect(result).toBeNull();
    expect(repo.getTwitter).toHaveBeenCalledTimes(1);
  });

  it("returns null when repo.getTwitter() throws on malformed JSON row", async () => {
    const repo = makeTenantRepo({
      twitterThrows: new TypeError("first argument must be of type string or an instance of Buffer"),
    });
    expect(await resolveTwitterOAuth1Credentials({ repo, env: {} })).toBeNull();
  });
});

describe("resolveTwitterCollectorCookie (app-level store)", () => {
  it("test_REQ_086_shared_collector_cookies_hidden — resolves the shared cookie from the super-admin app store (no tenant repo involved), even if RETTIWT_API_KEY is set", async () => {
    const appRepo = makeAppRepo({
      twitterCollector: { apiKey: "db-cookie-blob", updatedAt: new Date() },
    });
    const env: NodeJS.ProcessEnv = { RETTIWT_API_KEY: "env-cookie-blob" };
    const result = await resolveTwitterCollectorCookie({ appRepo, env });
    expect(result).toEqual({ apiKey: "db-cookie-blob", source: "db" });
  });

  it("falls back to RETTIWT_API_KEY when the store row is absent", async () => {
    const appRepo = makeAppRepo({});
    const env: NodeJS.ProcessEnv = { RETTIWT_API_KEY: "env-cookie-blob" };
    const result = await resolveTwitterCollectorCookie({ appRepo, env });
    expect(result).toEqual({ apiKey: "env-cookie-blob", source: "env" });
  });

  it("returns null when both the store and env are empty", async () => {
    const appRepo = makeAppRepo({});
    expect(await resolveTwitterCollectorCookie({ appRepo, env: {} })).toBeNull();
  });

  it("returns null on store read failure and does NOT fall through to env", async () => {
    const appRepo = makeAppRepo({
      twitterCollectorThrows: new Error(
        "Unsupported state or unable to authenticate data",
      ),
    });
    const env: NodeJS.ProcessEnv = {
      RETTIWT_API_KEY: "env-cookie-should-not-shadow",
    };
    const result = await resolveTwitterCollectorCookie({ appRepo, env });
    expect(result).toBeNull();
    expect(appRepo.getTwitterCollector).toHaveBeenCalledTimes(1);
  });

  it("treats empty-string env as not configured", async () => {
    const appRepo = makeAppRepo({});
    const env: NodeJS.ProcessEnv = { RETTIWT_API_KEY: "" };
    expect(await resolveTwitterCollectorCookie({ appRepo, env })).toBeNull();
  });
});

describe("resolveTwitterOAuth2Client (app-level shared OAuth2 client, P13 REQ-081)", () => {
  it("resolves the shared client from the super-admin app store, even when env is set", async () => {
    const appRepo = makeAppRepo({
      twitterClient: {
        clientId: "store-tw-id",
        clientSecret: "store-tw-secret",
        updatedAt: new Date(),
      },
    });
    const env: NodeJS.ProcessEnv = {
      TWITTER_OAUTH2_CLIENT_ID: "env-tw-id",
      TWITTER_OAUTH2_CLIENT_SECRET: "env-tw-secret",
    };
    expect(await resolveTwitterOAuth2Client({ appRepo, env })).toEqual({
      clientId: "store-tw-id",
      clientSecret: "store-tw-secret",
    });
  });

  it("falls back to TWITTER_OAUTH2_CLIENT_ID/SECRET when the store row is absent", async () => {
    const appRepo = makeAppRepo({});
    const env: NodeJS.ProcessEnv = {
      TWITTER_OAUTH2_CLIENT_ID: "env-tw-id",
      TWITTER_OAUTH2_CLIENT_SECRET: "env-tw-secret",
    };
    expect(await resolveTwitterOAuth2Client({ appRepo, env })).toEqual({
      clientId: "env-tw-id",
      clientSecret: "env-tw-secret",
    });
  });

  it("returns null when both the store and env are empty (or env is partial)", async () => {
    const appRepo = makeAppRepo({});
    expect(await resolveTwitterOAuth2Client({ appRepo, env: {} })).toBeNull();
    expect(
      await resolveTwitterOAuth2Client({
        appRepo,
        env: { TWITTER_OAUTH2_CLIENT_ID: "only-id" },
      }),
    ).toBeNull();
  });

  it("returns null on store read failure and does NOT fall through to env", async () => {
    const appRepo = makeAppRepo({ twitterClientThrows: new Error("decrypt failed") });
    const env: NodeJS.ProcessEnv = {
      TWITTER_OAUTH2_CLIENT_ID: "env-tw-id",
      TWITTER_OAUTH2_CLIENT_SECRET: "env-tw-secret",
    };
    expect(await resolveTwitterOAuth2Client({ appRepo, env })).toBeNull();
  });
});
