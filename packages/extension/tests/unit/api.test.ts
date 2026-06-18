import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { login, submit } from "../../src/lib/api";

const API_BASE = "http://localhost:3000";

function makeFetchStub(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  });
}

describe("api.login", () => {
  beforeEach(() => {
    vi.stubGlobal("import.meta", { env: { VITE_API_BASE: API_BASE } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("test_REQ_014_api_login_sends_correct_request", async () => {
    const fetchStub = makeFetchStub(200, {
      token: "tok123",
      expiresAt: 9999,
    });
    vi.stubGlobal("fetch", fetchStub);

    const result = await login("secret");

    expect(fetchStub).toHaveBeenCalledOnce();
    const [url, init] = fetchStub.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_BASE}/api/extension/login`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
    expect(JSON.parse(init.body as string)).toEqual({ password: "secret" });
    expect(result.token).toBe("tok123");
  });

  it("test_REQ_014_api_login_throws_with_status_on_401", async () => {
    vi.stubGlobal("fetch", makeFetchStub(401, { error: "invalid_password" }));

    const err = await login("wrong").catch((e: unknown) => e);
    expect((err as { status: number }).status).toBe(401);
  });
});

describe("api.submit", () => {
  beforeEach(() => {
    vi.stubGlobal("import.meta", { env: { VITE_API_BASE: API_BASE } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("test_REQ_014_api_submit_sends_bearer_auth_and_body", async () => {
    const fetchStub = makeFetchStub(201, {
      id: "abc",
      url: "https://example.com",
      sourceType: "manual",
      alreadyExisted: false,
    });
    vi.stubGlobal("fetch", fetchStub);

    const result = await submit("https://example.com", "Example", "tok-abc");

    expect(fetchStub).toHaveBeenCalledOnce();
    const [url, init] = fetchStub.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_BASE}/api/extension/submissions`);
    expect(init.method).toBe("POST");
    expect(
      (init.headers as Record<string, string>).Authorization,
    ).toBe("Bearer tok-abc");
    expect(JSON.parse(init.body as string)).toEqual({
      url: "https://example.com",
      title: "Example",
    });
    expect(result.alreadyExisted).toBe(false);
  });

  it("test_REQ_014_api_submit_throws_on_401", async () => {
    vi.stubGlobal("fetch", makeFetchStub(401, { error: "unauthorized" }));

    const err = await submit("https://x.com", undefined, "bad-tok").catch(
      (e: unknown) => e,
    );
    expect((err as { status: number }).status).toBe(401);
  });
});
