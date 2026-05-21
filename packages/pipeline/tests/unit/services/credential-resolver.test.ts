import { describe, it, expect, vi } from "vitest";
import {
  resolveLinkedInCredentials,
  resolveTwitterCollectorCookie,
  resolveTwitterOAuth1Credentials,
} from "@pipeline/services/credential-resolver.js";
import type { SocialCredentialsRepo } from "@pipeline/repositories/social-credentials.js";

function makeRepo(opts: {
  linkedin?: Awaited<ReturnType<SocialCredentialsRepo["getLinkedIn"]>>;
  twitter?: Awaited<ReturnType<SocialCredentialsRepo["getTwitter"]>>;
  twitterCollector?: Awaited<
    ReturnType<SocialCredentialsRepo["getTwitterCollector"]>
  >;
  twitterCollectorThrows?: Error;
}): SocialCredentialsRepo {
  return {
    getLinkedIn: vi.fn().mockResolvedValue(opts.linkedin ?? null),
    getTwitter: vi.fn().mockResolvedValue(opts.twitter ?? null),
    getTwitterCollector: vi.fn(() => {
      if (opts.twitterCollectorThrows) {
        return Promise.reject(opts.twitterCollectorThrows);
      }
      return Promise.resolve(opts.twitterCollector ?? null);
    }),
    upsertLinkedIn: vi.fn(),
    upsertTwitter: vi.fn(),
    upsertTwitterCollector: vi.fn(),
    delete: vi.fn(),
  };
}

describe("resolveLinkedInCredentials (VS-3 DB beats env)", () => {
  it("returns DB values when DB row exists, even if env is set", async () => {
    const repo = makeRepo({
      linkedin: {
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
    const result = await resolveLinkedInCredentials({ repo, env });
    expect(result).toEqual({
      clientId: "db-id",
      clientSecret: "db-secret",
      apiVersion: "202510",
    });
  });

  it("defaults apiVersion to 202511 when DB row has apiVersion=null", async () => {
    const repo = makeRepo({
      linkedin: {
        clientId: "db-id",
        clientSecret: "db-secret",
        apiVersion: null,
        updatedAt: new Date(),
      },
    });
    const result = await resolveLinkedInCredentials({ repo, env: {} });
    expect(result).toEqual({
      clientId: "db-id",
      clientSecret: "db-secret",
      apiVersion: "202511",
    });
  });
});

describe("resolveLinkedInCredentials (VS-4 env fallback)", () => {
  it("falls back to env when DB returns null", async () => {
    const repo = makeRepo({ linkedin: null });
    const env: NodeJS.ProcessEnv = {
      LINKEDIN_CLIENT_ID: "env-id",
      LINKEDIN_CLIENT_SECRET: "env-secret",
    };
    const result = await resolveLinkedInCredentials({ repo, env });
    expect(result).toEqual({
      clientId: "env-id",
      clientSecret: "env-secret",
      apiVersion: "202511",
    });
  });

  it("uses LINKEDIN_API_VERSION from env when present", async () => {
    const repo = makeRepo({ linkedin: null });
    const env: NodeJS.ProcessEnv = {
      LINKEDIN_CLIENT_ID: "env-id",
      LINKEDIN_CLIENT_SECRET: "env-secret",
      LINKEDIN_API_VERSION: "999999",
    };
    const result = await resolveLinkedInCredentials({ repo, env });
    expect(result?.apiVersion).toBe("999999");
  });
});

describe("resolveLinkedInCredentials (VS-5 both empty → null)", () => {
  it("returns null when DB is null and env has nothing", async () => {
    const repo = makeRepo({ linkedin: null });
    expect(await resolveLinkedInCredentials({ repo, env: {} })).toBeNull();
  });

  it("returns null when only LINKEDIN_CLIENT_ID is set in env", async () => {
    const repo = makeRepo({ linkedin: null });
    const env: NodeJS.ProcessEnv = { LINKEDIN_CLIENT_ID: "id-only" };
    expect(await resolveLinkedInCredentials({ repo, env })).toBeNull();
  });

  it("returns null when secret is empty string in env", async () => {
    const repo = makeRepo({ linkedin: null });
    const env: NodeJS.ProcessEnv = {
      LINKEDIN_CLIENT_ID: "id",
      LINKEDIN_CLIENT_SECRET: "",
    };
    expect(await resolveLinkedInCredentials({ repo, env })).toBeNull();
  });
});

describe("resolveTwitterOAuth1Credentials (VS-3 DB beats env)", () => {
  it("returns DB values when DB row exists", async () => {
    const repo = makeRepo({
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

describe("resolveTwitterOAuth1Credentials (VS-4 env fallback)", () => {
  it("falls back to env when DB returns null and all 4 env keys are set", async () => {
    const repo = makeRepo({ twitter: null });
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

describe("resolveTwitterOAuth1Credentials (VS-5 both empty → null)", () => {
  it("returns null when DB null and env empty", async () => {
    const repo = makeRepo({ twitter: null });
    expect(await resolveTwitterOAuth1Credentials({ repo, env: {} })).toBeNull();
  });
});

describe("resolveTwitterOAuth1Credentials (VS-5b partial env → null)", () => {
  it("returns null when only 3 of 4 Twitter env keys are present", async () => {
    const repo = makeRepo({ twitter: null });
    const env: NodeJS.ProcessEnv = {
      TWITTER_API_KEY: "k",
      TWITTER_API_SECRET: "s",
      TWITTER_ACCESS_TOKEN: "t",
      // TWITTER_ACCESS_TOKEN_SECRET intentionally missing
    };
    expect(await resolveTwitterOAuth1Credentials({ repo, env })).toBeNull();
  });

  it("returns null when one of the 4 keys is empty string", async () => {
    const repo = makeRepo({ twitter: null });
    const env: NodeJS.ProcessEnv = {
      TWITTER_API_KEY: "k",
      TWITTER_API_SECRET: "s",
      TWITTER_ACCESS_TOKEN: "t",
      TWITTER_ACCESS_TOKEN_SECRET: "",
    };
    expect(await resolveTwitterOAuth1Credentials({ repo, env })).toBeNull();
  });
});

// Spec.md ## Edge cases:
// "Cipher decrypt fails (e.g. SESSION_SECRET rotated): resolver SHALL log a
//  clear error and return null. The corresponding platform SHALL be skipped
//  for that run; the pipeline run SHALL NOT fail."
// "Schema drift (malformed JSON): resolver SHALL log and return null rather
//  than throw."
describe("resolveLinkedInCredentials — DB read failure is non-fatal (Edge cases D1/D2)", () => {
  it("returns null and does NOT throw when repo.getLinkedIn() throws (decrypt failure)", async () => {
    const repo: SocialCredentialsRepo = {
      getLinkedIn: vi
        .fn()
        .mockRejectedValue(new Error("Unsupported state or unable to authenticate data")),
      getTwitter: vi.fn().mockResolvedValue(null),
      getTwitterCollector: vi.fn().mockResolvedValue(null),
      upsertLinkedIn: vi.fn(),
      upsertTwitter: vi.fn(),
      upsertTwitterCollector: vi.fn(),
      delete: vi.fn(),
    };
    // Env IS set — but per spec, a decrypt failure on a present DB row must
    // skip the platform, NOT silently fall through to env (which would mask
    // a legitimate admin-saved row with stale env values).
    const env: NodeJS.ProcessEnv = {
      LINKEDIN_CLIENT_ID: "env-id-should-not-shadow",
      LINKEDIN_CLIENT_SECRET: "env-secret",
      LINKEDIN_API_VERSION: "202511",
    };
    const result = await resolveLinkedInCredentials({ repo, env });
    expect(result).toBeNull();
    expect(repo.getLinkedIn).toHaveBeenCalledTimes(1);
  });

  it("returns null when repo.getLinkedIn() throws even with no env", async () => {
    const repo: SocialCredentialsRepo = {
      getLinkedIn: vi.fn().mockRejectedValue(new TypeError("first argument must be of type string or an instance of Buffer")),
      getTwitter: vi.fn().mockResolvedValue(null),
      getTwitterCollector: vi.fn().mockResolvedValue(null),
      upsertLinkedIn: vi.fn(),
      upsertTwitter: vi.fn(),
      upsertTwitterCollector: vi.fn(),
      delete: vi.fn(),
    };
    expect(await resolveLinkedInCredentials({ repo, env: {} })).toBeNull();
  });
});

describe("resolveTwitterOAuth1Credentials — DB read failure is non-fatal (Edge cases D1/D2)", () => {
  it("returns null and does NOT throw when repo.getTwitter() throws (decrypt failure)", async () => {
    const repo: SocialCredentialsRepo = {
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
    const repo: SocialCredentialsRepo = {
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
    expect(await resolveTwitterOAuth1Credentials({ repo, env: {} })).toBeNull();
  });
});


describe("resolveTwitterCollectorCookie (VS-2 / VS-6)", () => {
  it("returns DB value when present, even if RETTIWT_API_KEY is set", async () => {
    const repo = makeRepo({
      twitterCollector: { apiKey: "db-cookie-blob", updatedAt: new Date() },
    });
    const env: NodeJS.ProcessEnv = { RETTIWT_API_KEY: "env-cookie-blob" };
    const result = await resolveTwitterCollectorCookie({ repo, env });
    expect(result).toEqual({ apiKey: "db-cookie-blob" });
  });

  it("falls back to RETTIWT_API_KEY when DB row absent", async () => {
    const repo = makeRepo({});
    const env: NodeJS.ProcessEnv = { RETTIWT_API_KEY: "env-cookie-blob" };
    const result = await resolveTwitterCollectorCookie({ repo, env });
    expect(result).toEqual({ apiKey: "env-cookie-blob" });
  });

  it("returns null when both DB and env are empty", async () => {
    const repo = makeRepo({});
    expect(await resolveTwitterCollectorCookie({ repo, env: {} })).toBeNull();
  });

  it("returns null on DB read failure and does NOT fall through to env (VS-6)", async () => {
    const repo = makeRepo({
      twitterCollectorThrows: new Error(
        "Unsupported state or unable to authenticate data",
      ),
    });
    const env: NodeJS.ProcessEnv = {
      RETTIWT_API_KEY: "env-cookie-should-not-shadow",
    };
    const result = await resolveTwitterCollectorCookie({ repo, env });
    expect(result).toBeNull();
    expect(repo.getTwitterCollector).toHaveBeenCalledTimes(1);
  });

  it("treats empty-string env as not configured", async () => {
    const repo = makeRepo({});
    const env: NodeJS.ProcessEnv = { RETTIWT_API_KEY: "" };
    expect(await resolveTwitterCollectorCookie({ repo, env })).toBeNull();
  });
});
