import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@pipeline/services/markdown-fetch.js", () => ({
  delay: vi.fn().mockResolvedValue(undefined),
}));

import { fetchWithRetry } from "@pipeline/lib/fetch-with-retry";

interface MockResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

function createMockFetch(responses: MockResponse[]): ReturnType<typeof vi.fn> {
  let i = 0;
  return vi.fn().mockImplementation(() => {
    const r = responses[i] ?? responses[responses.length - 1];
    i++;
    if (!r.ok && r.status === 0) return Promise.reject(new Error("Network error"));
    return Promise.resolve({
      ok: r.ok,
      status: r.status,
      json: () => Promise.resolve(r.body),
    });
  });
}

describe("fetchWithRetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns parsed result on successful first call", async () => {
    const fetchFn = createMockFetch([{ ok: true, status: 200, body: { items: [1, 2, 3] } }]);
    const parse = (data: unknown) => (data as { items: number[] }).items;

    const result = await fetchWithRetry(fetchFn as typeof fetch, "https://example.com", parse);

    expect(result).toEqual([1, 2, 3]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("throws immediately on 404 without retrying", async () => {
    const fetchFn = createMockFetch([{ ok: false, status: 404, body: null }]);

    await expect(
      fetchWithRetry(fetchFn as typeof fetch, "https://example.com", (d) => d),
    ).rejects.toThrow("Non-retryable HTTP error: 404");

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("throws immediately on 403 without retrying", async () => {
    const fetchFn = createMockFetch([{ ok: false, status: 403, body: null }]);

    await expect(
      fetchWithRetry(fetchFn as typeof fetch, "https://example.com", (d) => d),
    ).rejects.toThrow("Non-retryable HTTP error: 403");

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("does not throw immediately on 429 — retries instead", async () => {
    // 429 followed by success: if it threw immediately it would fail before the second call
    const fetchFn = createMockFetch([
      { ok: false, status: 429, body: null },
      { ok: true, status: 200, body: "ok" },
    ]);

    const result = await fetchWithRetry(
      fetchFn as typeof fetch,
      "https://example.com",
      (d) => d,
      2,
    );

    expect(result).toBe("ok");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("retries on 5xx and eventually throws after exhausting retries", async () => {
    const fetchFn = createMockFetch([
      { ok: false, status: 503, body: null },
      { ok: false, status: 503, body: null },
      { ok: false, status: 503, body: null },
    ]);

    await expect(
      fetchWithRetry(fetchFn as typeof fetch, "https://example.com", (d) => d, 3),
    ).rejects.toThrow();

    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("returns value on first success after a transient 5xx", async () => {
    const fetchFn = createMockFetch([
      { ok: false, status: 503, body: null },
      { ok: true, status: 200, body: { value: 42 } },
    ]);
    const parse = (data: unknown) => (data as { value: number }).value;

    const result = await fetchWithRetry(fetchFn as typeof fetch, "https://example.com", parse, 3);

    expect(result).toBe(42);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("retries on network error and eventually throws", async () => {
    const fetchFn = createMockFetch([
      { ok: false, status: 0, body: null },
      { ok: false, status: 0, body: null },
      { ok: false, status: 0, body: null },
    ]);

    await expect(
      fetchWithRetry(fetchFn as typeof fetch, "https://example.com", (d) => d, 3),
    ).rejects.toThrow("Network error");

    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("forwards parse return value as the function return value", async () => {
    const fetchFn = createMockFetch([{ ok: true, status: 200, body: { count: 7 } }]);
    const parse = (data: unknown) => (data as { count: number }).count * 2;

    const result = await fetchWithRetry(fetchFn as typeof fetch, "https://example.com", parse);

    expect(result).toBe(14);
  });
});
