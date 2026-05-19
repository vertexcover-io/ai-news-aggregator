import { describe, it, expect, vi } from "vitest";
import {
  resolveLinkedInCredentials,
  resolveTwitterOAuth1Credentials,
} from "@pipeline/services/credential-resolver.js";
import type { SocialCredentialsRepo } from "@pipeline/repositories/social-credentials.js";

function makeRepo(opts: {
  linkedin?: Awaited<ReturnType<SocialCredentialsRepo["getLinkedIn"]>>;
  twitter?: Awaited<ReturnType<SocialCredentialsRepo["getTwitter"]>>;
}): SocialCredentialsRepo {
  return {
    getLinkedIn: vi.fn().mockResolvedValue(opts.linkedin ?? null),
    getTwitter: vi.fn().mockResolvedValue(opts.twitter ?? null),
    upsertLinkedIn: vi.fn(),
    upsertTwitter: vi.fn(),
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
