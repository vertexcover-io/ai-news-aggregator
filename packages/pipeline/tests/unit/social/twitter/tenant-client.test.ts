import { describe, expect, it, vi } from "vitest";
import { TENANT_ZERO_ID } from "@newsletter/shared/constants";
import type { Logger } from "@newsletter/shared/logger";

import type { SocialCredentialsRepo } from "@pipeline/repositories/social-credentials.js";
import type {
  SocialTokenRow,
  SocialTokensRepo,
} from "@pipeline/repositories/social-tokens.js";
import {
  buildTenantTwitterApiClient,
  readTwitterOAuth2AppClient,
} from "@pipeline/social/twitter/tenant-client.js";
import type { TwitterApiClient } from "@pipeline/social/twitter/types.js";

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

function oauth2Row(): SocialTokenRow {
  return {
    platform: "twitter",
    accessToken: "at",
    refreshToken: "rt",
    expiresAt: new Date(NOW.getTime() + 3600 * 1000),
    metadata: null,
    updatedAt: NOW,
  };
}

function makeTokens(
  twitterRow: SocialTokenRow | null,
): Pick<SocialTokensRepo, "getToken" | "withTokenLock"> {
  return {
    getToken: vi.fn().mockResolvedValue(twitterRow),
    withTokenLock: vi.fn(),
  };
}

function makeCredentials(
  twitterRecord: {
    apiKey: string;
    apiSecret: string;
    accessToken: string;
    accessTokenSecret: string;
  } | null,
): SocialCredentialsRepo {
  return {
    getLinkedIn: vi.fn().mockResolvedValue(null),
    getTwitter: vi.fn().mockResolvedValue(twitterRecord),
    getTwitterCollector: vi.fn().mockResolvedValue(null),
    upsertLinkedIn: vi.fn(),
    upsertTwitter: vi.fn(),
    upsertTwitterCollector: vi.fn(),
    delete: vi.fn(),
  } as unknown as SocialCredentialsRepo;
}

const OAUTH1_ENV = {
  TWITTER_API_KEY: "k",
  TWITTER_API_SECRET: "s",
  TWITTER_ACCESS_TOKEN: "t",
  TWITTER_ACCESS_TOKEN_SECRET: "ts",
} as NodeJS.ProcessEnv;

const fakeClient = (): TwitterApiClient => ({
  createPost: vi.fn(),
  validateCredentials: vi.fn(),
});

describe("readTwitterOAuth2AppClient", () => {
  it("returns the app client when both env keys are set", () => {
    expect(
      readTwitterOAuth2AppClient({
        TWITTER_OAUTH_CLIENT_ID: "cid",
        TWITTER_OAUTH_CLIENT_SECRET: "cs",
      } as NodeJS.ProcessEnv),
    ).toEqual({ clientId: "cid", clientSecret: "cs" });
  });

  it("returns null when either key is missing or empty", () => {
    expect(readTwitterOAuth2AppClient({} as NodeJS.ProcessEnv)).toBeNull();
    expect(
      readTwitterOAuth2AppClient({
        TWITTER_OAUTH_CLIENT_ID: "cid",
        TWITTER_OAUTH_CLIENT_SECRET: "",
      } as NodeJS.ProcessEnv),
    ).toBeNull();
  });
});

describe("buildTenantTwitterApiClient", () => {
  it("REQ-081: OAuth2 token row → builds the per-tenant OAuth2 client", async () => {
    const oauth2 = fakeClient();
    const oauth2Factory = vi.fn().mockReturnValue(oauth2);
    const oauth1Factory = vi.fn();

    const client = await buildTenantTwitterApiClient({
      tenantId: TENANT_A,
      tokens: makeTokens(oauth2Row()),
      credentials: makeCredentials(null),
      logger: makeLogger(),
      env: {
        TWITTER_OAUTH_CLIENT_ID: "cid",
        TWITTER_OAUTH_CLIENT_SECRET: "cs",
        ...OAUTH1_ENV, // present but must be ignored: oauth2 wins
      } as NodeJS.ProcessEnv,
      oauth2Factory,
      oauth1Factory,
    });

    expect(client).toBe(oauth2);
    expect(oauth2Factory).toHaveBeenCalledWith(
      expect.objectContaining({
        appClient: { clientId: "cid", clientSecret: "cs" },
      }),
    );
    expect(oauth1Factory).not.toHaveBeenCalled();
  });

  it("NF3: tenant 0 with no OAuth2 row falls back to env OAuth1 manual keys", async () => {
    const oauth1 = fakeClient();
    const oauth1Factory = vi.fn().mockReturnValue(oauth1);

    const client = await buildTenantTwitterApiClient({
      tenantId: TENANT_ZERO_ID,
      tokens: makeTokens(null),
      credentials: makeCredentials(null),
      logger: makeLogger(),
      env: OAUTH1_ENV,
      oauth1Factory,
    });

    expect(client).toBe(oauth1);
    expect(oauth1Factory).toHaveBeenCalledWith({
      appKey: "k",
      appSecret: "s",
      accessToken: "t",
      accessSecret: "ts",
    });
  });

  it("NF3: tenant 0 manual DB row wins over env keys", async () => {
    const oauth1Factory = vi.fn().mockReturnValue(fakeClient());

    await buildTenantTwitterApiClient({
      tenantId: TENANT_ZERO_ID,
      tokens: makeTokens(null),
      credentials: makeCredentials({
        apiKey: "db-k",
        apiSecret: "db-s",
        accessToken: "db-t",
        accessTokenSecret: "db-ts",
      }),
      logger: makeLogger(),
      env: OAUTH1_ENV,
      oauth1Factory,
    });

    expect(oauth1Factory).toHaveBeenCalledWith({
      appKey: "db-k",
      appSecret: "db-s",
      accessToken: "db-t",
      accessSecret: "db-ts",
    });
  });

  it("non-zero tenant with no OAuth2 row gets null EVEN when env OAuth1 keys exist (no credential leak)", async () => {
    const oauth1Factory = vi.fn();

    const client = await buildTenantTwitterApiClient({
      tenantId: TENANT_A,
      tokens: makeTokens(null),
      credentials: makeCredentials(null),
      logger: makeLogger(),
      env: OAUTH1_ENV,
      oauth1Factory,
    });

    expect(client).toBeNull();
    expect(oauth1Factory).not.toHaveBeenCalled();
  });

  it("tenant 0 with nothing configured anywhere → null", async () => {
    const client = await buildTenantTwitterApiClient({
      tenantId: TENANT_ZERO_ID,
      tokens: makeTokens(null),
      credentials: makeCredentials(null),
      logger: makeLogger(),
      env: {} as NodeJS.ProcessEnv,
    });
    expect(client).toBeNull();
  });

  it("OAuth2 row without TWITTER_OAUTH_CLIENT_ID/SECRET still builds a client (refresh disabled) and warns", async () => {
    const oauth2Factory = vi.fn().mockReturnValue(fakeClient());
    const logger = makeLogger();

    const client = await buildTenantTwitterApiClient({
      tenantId: TENANT_A,
      tokens: makeTokens(oauth2Row()),
      credentials: makeCredentials(null),
      logger,
      env: {} as NodeJS.ProcessEnv,
      oauth2Factory,
    });

    expect(client).not.toBeNull();
    expect(oauth2Factory).toHaveBeenCalledWith(
      expect.objectContaining({ appClient: null }),
    );
    expect(logger.warn).toHaveBeenCalled();
  });
});
