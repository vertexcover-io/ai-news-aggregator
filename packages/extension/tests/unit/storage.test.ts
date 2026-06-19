import { describe, it, expect, vi, beforeEach } from "vitest";
import { getToken, setToken, clearToken } from "../../src/lib/storage";

// Stub chrome.storage.local with a simple in-memory map
function makeStorage() {
  const store: Record<string, unknown> = {};
  return {
    get: vi.fn((key: string) => Promise.resolve({ [key]: store[key] })),
    set: vi.fn((items: Record<string, unknown>) => {
      Object.assign(store, items);
      return Promise.resolve();
    }),
    remove: vi.fn((key: string) => {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete store[key];
      return Promise.resolve();
    }),
    _store: store,
  };
}

describe("storage", () => {
  let storage: ReturnType<typeof makeStorage>;

  beforeEach(() => {
    storage = makeStorage();
    vi.stubGlobal("chrome", {
      storage: { local: storage },
    });
  });

  it("test_REQ_014_storage_getToken_returns_null_when_empty", async () => {
    const token = await getToken();
    expect(token).toBeNull();
  });

  it("test_REQ_014_storage_round_trip_set_get", async () => {
    await setToken("my-token-value");
    const token = await getToken();
    expect(token).toBe("my-token-value");
  });

  it("test_REQ_014_storage_clear_removes_token", async () => {
    await setToken("some-token");
    await clearToken();
    const token = await getToken();
    expect(token).toBeNull();
  });
});
