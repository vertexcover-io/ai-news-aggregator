import { beforeEach, describe, expect, it, vi } from "vitest";

const refreshCsrfToken = vi.fn();

vi.mock("rettiwt-api/dist/services/internal/AuthService.js", () => ({
  AuthService: {
    getUserId: vi.fn(() => "2049717123434590208"),
    refreshCsrfToken,
  },
}));

vi.mock("@newsletter/shared/logger", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

const { refreshRettiwtCsrfToken } = await import(
  "@pipeline/collectors/twitter/clients/rettiwt-auth.js"
);

function makeApiKey(ct0: string): string {
  return Buffer.from(
    `auth_token=token; ct0=${ct0}; kdt=kdt; twid=u%3D2049717123434590208;`,
    "utf8",
  ).toString("base64");
}

describe("refreshRettiwtCsrfToken", () => {
  beforeEach(() => {
    refreshCsrfToken.mockReset();
  });

  it("rotates the Rettiwt api key and persists DB-managed collector credentials", async () => {
    const rotatedApiKey = makeApiKey("rotated");
    const rettiwt = { apiKey: makeApiKey("stale") };
    const repo = { upsertTwitterCollector: vi.fn(() => Promise.resolve()) };
    refreshCsrfToken.mockImplementationOnce((config: { apiKey: string | undefined }) => {
      config.apiKey = rotatedApiKey;
      return Promise.resolve();
    });

    const refreshed = await refreshRettiwtCsrfToken({
      rettiwt,
      repo,
      credentialSource: "db",
    });

    expect(refreshed).toBe(true);
    expect(rettiwt.apiKey).toBe(rotatedApiKey);
    expect(repo.upsertTwitterCollector).toHaveBeenCalledWith({
      apiKey: rotatedApiKey,
    });
  });

  it("rotates env fallback credentials in memory without creating a DB row", async () => {
    const rotatedApiKey = makeApiKey("rotated-env");
    const rettiwt = { apiKey: makeApiKey("env") };
    const repo = { upsertTwitterCollector: vi.fn(() => Promise.resolve()) };
    refreshCsrfToken.mockImplementationOnce((config: { apiKey: string | undefined }) => {
      config.apiKey = rotatedApiKey;
      return Promise.resolve();
    });

    const refreshed = await refreshRettiwtCsrfToken({
      rettiwt,
      repo,
      credentialSource: "env",
    });

    expect(refreshed).toBe(true);
    expect(rettiwt.apiKey).toBe(rotatedApiKey);
    expect(repo.upsertTwitterCollector).not.toHaveBeenCalled();
  });

  it("returns false when Rettiwt does not provide a rotated api key", async () => {
    const currentApiKey = makeApiKey("current");
    const rettiwt = { apiKey: currentApiKey };
    const repo = { upsertTwitterCollector: vi.fn(() => Promise.resolve()) };
    refreshCsrfToken.mockImplementationOnce(() => Promise.resolve());

    const refreshed = await refreshRettiwtCsrfToken({
      rettiwt,
      repo,
      credentialSource: "db",
    });

    expect(refreshed).toBe(false);
    expect(rettiwt.apiKey).toBe(currentApiKey);
    expect(repo.upsertTwitterCollector).not.toHaveBeenCalled();
  });
});
