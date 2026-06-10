import { describe, it, expect, vi } from "vitest";
import {
  resolveLinkedInCredentials,
  resolveTwitterCollectorCookie,
  resolveTwitterOAuth1Credentials,
} from "@pipeline/services/credential-resolver.js";
import type { SocialCredentialsRepo } from "@pipeline/repositories/social-credentials.js";
import type { AppCredentialsRepo } from "@pipeline/repositories/app-credentials.js";

function makeSocialRepo(opts: {
  twitter?: Awaited<ReturnType<SocialCredentialsRepo["getTwitter"]>>;
}): SocialCredentialsRepo {
  return {
    getLinkedIn: vi.fn().mockResolvedValue(null),
    getTwitter: vi.fn().mockResolvedValue(opts.twitter ?? null),
    getTwitterCollector: vi.fn().mockResolvedValue(null),
    upsertLinkedIn: vi.fn(),
    upsertTwitter: vi.fn(),
    upsertTwitterCollector: vi.fn(),
    delete: vi.fn(),
  };
}

function makeAppRepo(opts: {
  linkedin?: Awaited<ReturnType<AppCredentialsRepo["getLinkedIn"]>>;
  twitterCollector?: Awaited<ReturnType<AppCredentialsRepo["getTwitterCollector"]>>;
  twitterCollectorThrows?: Error;
  linkedinThrows?: Error;
}): AppCredentialsRepo {
  return {
    getLinkedIn: vi.fn(() => {
      if (opts.linkedinThrows) return Promise.reject(opts.linkedinThrows);
      return Promise.resolve(opts.linkedin ?? null);
    }),
    getTwitterCollector: vi.fn(() => {
      if (opts.twitterCollectorThrows) return Promise.reject(opts.twitterCollectorThrows);
      return Promise.resolve(opts.twitterCollector ?? null);
    }),
  };
}

function deps(appRepo: AppCredentialsRepo, socialRepo: SocialCredentialsRepo, env?: NodeJS.ProcessEnv) {
  return { appRepo, socialRepo, env: env ?? {} };
}

describe("resolveLinkedInCredentials (VS-3 DB beats env)", () => {
  it("returns DB values when DB row exists, even if env is set", async () => {
    const appRepo = makeAppRepo({
      linkedin: {
        clientId: "db-id",
        clientSecret: "db-secret",
        apiVersion: "202510",
        updatedAt: new Date(),
      },
    });
    const socialRepo = makeSocialRepo({});
    const env: NodeJS.ProcessEnv = {
      LINKEDIN_CLIENT_ID: "env-id",
      LINKEDIN_CLIENT_SECRET: "env-secret",
      LINKEDIN_API_VERSION: "202501",
    };
    const result = await resolveLinkedInCredentials(deps(appRepo, socialRepo, env));
    expect(result).toEqual({
      clientId: "db-id",
      clientSecret: "db-secret",
      apiVersion: "202510",
    });
  });

  it("defaults apiVersion to 202511 when DB row has apiVersion=null", async () => {
    const appRepo = makeAppRepo({
      linkedin: {
        clientId: "db-id",
        clientSecret: "db-secret",
        apiVersion: null,
        updatedAt: new Date(),
      },
    });
    const socialRepo = makeSocialRepo({});
    const result = await resolveLinkedInCredentials(deps(appRepo, socialRepo));
    expect(result).toEqual({
      clientId: "db-id",
      clientSecret: "db-secret",
      apiVersion: "202511",
    });
  });
});

describe("resolveLinkedInCredentials (VS-4 env fallback)", () => {
  it.each([
    {
      name: "falls back to env (default apiVersion) when DB returns null",
      env: { LINKEDIN_CLIENT_ID: "env-id", LINKEDIN_CLIENT_SECRET: "env-secret" },
      expected: { clientId: "env-id", clientSecret: "env-secret", apiVersion: "202511" },
    },
    {
      name: "uses LINKEDIN_API_VERSION from env when present",
      env: { LINKEDIN_CLIENT_ID: "env-id", LINKEDIN_CLIENT_SECRET: "env-secret", LINKEDIN_API_VERSION: "999999" },
      expected: { clientId: "env-id", clientSecret: "env-secret", apiVersion: "999999" },
    },
  ])("$name", async ({ env, expected }) => {
    const appRepo = makeAppRepo({ linkedin: null });
    const socialRepo = makeSocialRepo({});
    const result = await resolveLinkedInCredentials(deps(appRepo, socialRepo, env));
    expect(result).toEqual(expected);
  });
});

describe("resolveLinkedInCredentials (VS-5 both empty / partial -> null)", () => {
  it.each<{ name: string; env: NodeJS.ProcessEnv }>([
    { name: "DB null and env has nothing", env: {} },
    { name: "only LINKEDIN_CLIENT_ID set in env", env: { LINKEDIN_CLIENT_ID: "id-only" } },
    { name: "secret is empty string in env", env: { LINKEDIN_CLIENT_ID: "id", LINKEDIN_CLIENT_SECRET: "" } },
  ])("returns null when $name", async ({ env }) => {
    const appRepo = makeAppRepo({ linkedin: null });
    const socialRepo = makeSocialRepo({});
    expect(await resolveLinkedInCredentials(deps(appRepo, socialRepo, env))).toBeNull();
  });
});

describe("resolveTwitterOAuth1Credentials (VS-3 DB beats env)", () => {
  it("returns DB values when DB row exists", async () => {
    const socialRepo = makeSocialRepo({
      twitter: {
        apiKey: "db-key",
        apiSecret: "db-secret",
        accessToken: "db-at",
        accessTokenSecret: "db-ats",
        updatedAt: new Date(),
      },
    });
    const appRepo = makeAppRepo({});
    const env: NodeJS.ProcessEnv = {
      TWITTER_API_KEY: "env-key",
      TWITTER_API_SECRET: "env-secret",
      TWITTER_ACCESS_TOKEN: "env-at",
      TWITTER_ACCESS_TOKEN_SECRET: "env-ats",
    };
    const result = await resolveTwitterOAuth1Credentials(deps(appRepo, socialRepo, env));
    expect(result).toEqual({
      appKey: "db-key",
      appSecret: "db-secret",
      accessToken: "db-at",
      accessSecret: "db-ats",
    });
  });
});

describe("resolveTwitterOAuth1Credentials (VS-4 env fallback)", () => {
  it("falls back to env when DB returns null and all 4 env keys are set", async () => {
    const socialRepo = makeSocialRepo({ twitter: null });
    const appRepo = makeAppRepo({});
    const env: NodeJS.ProcessEnv = {
      TWITTER_API_KEY: "k",
      TWITTER_API_SECRET: "s",
      TWITTER_ACCESS_TOKEN: "t",
      TWITTER_ACCESS_TOKEN_SECRET: "ts",
    };
    const result = await resolveTwitterOAuth1Credentials(deps(appRepo, socialRepo, env));
    expect(result).toEqual({
      appKey: "k",
      appSecret: "s",
      accessToken: "t",
      accessSecret: "ts",
    });
  });
});

describe("resolveTwitterOAuth1Credentials (VS-5 both empty / partial -> null)", () => {
  it.each<{ name: string; env: NodeJS.ProcessEnv }>([
    { name: "DB null and env empty", env: {} },
    {
      name: "only 3 of 4 Twitter env keys are present",
      env: {
        TWITTER_API_KEY: "k",
        TWITTER_API_SECRET: "s",
        TWITTER_ACCESS_TOKEN: "t",
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
    const socialRepo = makeSocialRepo({ twitter: null });
    const appRepo = makeAppRepo({});
    expect(await resolveTwitterOAuth1Credentials(deps(appRepo, socialRepo, env))).toBeNull();
  });
});

describe("resolveLinkedInCredentials - DB read failure is non-fatal (Edge cases D1/D2)", () => {
  it("returns null and does NOT throw when appRepo.getLinkedIn() throws (decrypt failure)", async () => {
    const appRepo = makeAppRepo({
      linkedinThrows: new Error("Unsupported state or unable to authenticate data"),
    });
    const socialRepo = makeSocialRepo({});
    const env: NodeJS.ProcessEnv = {
      LINKEDIN_CLIENT_ID: "env-id-should-not-shadow",
      LINKEDIN_CLIENT_SECRET: "env-secret",
      LINKEDIN_API_VERSION: "202511",
    };
    const result = await resolveLinkedInCredentials(deps(appRepo, socialRepo, env));
    expect(result).toBeNull();
    expect(appRepo.getLinkedIn).toHaveBeenCalledTimes(1);
  });

  it("returns null when appRepo.getLinkedIn() throws even with no env", async () => {
    const appRepo = makeAppRepo({
      linkedinThrows: new TypeError("first argument must be of type string or an instance of Buffer"),
    });
    const socialRepo = makeSocialRepo({});
    expect(await resolveLinkedInCredentials(deps(appRepo, socialRepo))).toBeNull();
  });
});

describe("resolveTwitterOAuth1Credentials - DB read failure is non-fatal (Edge cases D1/D2)", () => {
  it("returns null and does NOT throw when socialRepo.getTwitter() throws (decrypt failure)", async () => {
    const socialRepo: SocialCredentialsRepo = {
      getLinkedIn: vi.fn().mockResolvedValue(null),
      getTwitter: vi
        .fn()
        .mockRejectedValue(new Error("Unsupported state or unable to authenticate data")),
      getTwitterCollector: vi.fn().mockResolvedValue(null),
      upsertLinkedIn: vi.fn(),
      upsertTwitter: vi.fn(),
      upsertTwitterCollector: vi.fn(),
      delete: vi.fn(),
    };
    const appRepo = makeAppRepo({});
    const env: NodeJS.ProcessEnv = {
      TWITTER_API_KEY: "env-k-should-not-shadow",
      TWITTER_API_SECRET: "env-s",
      TWITTER_ACCESS_TOKEN: "env-t",
      TWITTER_ACCESS_TOKEN_SECRET: "env-ts",
    };
    const result = await resolveTwitterOAuth1Credentials(deps(appRepo, socialRepo, env));
    expect(result).toBeNull();
    expect(socialRepo.getTwitter).toHaveBeenCalledTimes(1);
  });

  it("returns null when socialRepo.getTwitter() throws on malformed JSON row", async () => {
    const socialRepo: SocialCredentialsRepo = {
      getLinkedIn: vi.fn().mockResolvedValue(null),
      getTwitter: vi
        .fn()
        .mockRejectedValue(new TypeError("first argument must be of type string or an instance of Buffer")),
      getTwitterCollector: vi.fn().mockResolvedValue(null),
      upsertLinkedIn: vi.fn(),
      upsertTwitter: vi.fn(),
      upsertTwitterCollector: vi.fn(),
      delete: vi.fn(),
    };
    const appRepo = makeAppRepo({});
    expect(await resolveTwitterOAuth1Credentials(deps(appRepo, socialRepo))).toBeNull();
  });
});

describe("resolveTwitterCollectorCookie (VS-2 / VS-6)", () => {
  it("returns DB value when present, even if RETTIWT_API_KEY is set", async () => {
    const appRepo = makeAppRepo({
      twitterCollector: { apiKey: "db-cookie-blob", updatedAt: new Date() },
    });
    const socialRepo = makeSocialRepo({});
    const env: NodeJS.ProcessEnv = { RETTIWT_API_KEY: "env-cookie-blob" };
    const result = await resolveTwitterCollectorCookie(deps(appRepo, socialRepo, env));
    expect(result).toEqual({ apiKey: "db-cookie-blob", source: "db" });
  });

  it("falls back to RETTIWT_API_KEY when DB row absent", async () => {
    const appRepo = makeAppRepo({});
    const socialRepo = makeSocialRepo({});
    const env: NodeJS.ProcessEnv = { RETTIWT_API_KEY: "env-cookie-blob" };
    const result = await resolveTwitterCollectorCookie(deps(appRepo, socialRepo, env));
    expect(result).toEqual({ apiKey: "env-cookie-blob", source: "env" });
  });

  it("returns null when both DB and env are empty", async () => {
    const appRepo = makeAppRepo({});
    const socialRepo = makeSocialRepo({});
    expect(await resolveTwitterCollectorCookie(deps(appRepo, socialRepo))).toBeNull();
  });

  it("returns null on DB read failure and does NOT fall through to env (VS-6)", async () => {
    const appRepo = makeAppRepo({
      twitterCollectorThrows: new Error(
        "Unsupported state or unable to authenticate data",
      ),
    });
    const socialRepo = makeSocialRepo({});
    const env: NodeJS.ProcessEnv = {
      RETTIWT_API_KEY: "env-cookie-should-not-shadow",
    };
    const result = await resolveTwitterCollectorCookie(deps(appRepo, socialRepo, env));
    expect(result).toBeNull();
    expect(appRepo.getTwitterCollector).toHaveBeenCalledTimes(1);
  });

  it("treats empty-string env as not configured", async () => {
    const appRepo = makeAppRepo({});
    const socialRepo = makeSocialRepo({});
    const env: NodeJS.ProcessEnv = { RETTIWT_API_KEY: "" };
    expect(await resolveTwitterCollectorCookie(deps(appRepo, socialRepo, env))).toBeNull();
  });
});
