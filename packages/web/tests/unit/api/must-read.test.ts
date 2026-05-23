import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminMustReadEntry } from "@newsletter/shared/types";
import {
  DuplicateUrlError,
  createMustRead,
  deleteMustRead,
  listAdminMustRead,
  previewMustRead,
  updateMustRead,
} from "../../../src/api/must-read";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const sampleEntry: AdminMustReadEntry = {
  id: "11111111-1111-1111-1111-111111111111",
  url: "https://example.com/post",
  title: "Sample",
  author: "Ada",
  year: 2024,
  annotation: "Why it matters.",
  addedAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
};

describe("previewMustRead", () => {
  it("POSTs /api/admin/must-read/preview with url and returns extracted payload", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "extracted",
          suggested: { title: "T", author: "A", year: 2023 },
        }),
        { status: 200 },
      ),
    );
    const out = await previewMustRead({ url: "https://example.com" });
    expect(out).toEqual({
      status: "extracted",
      suggested: { title: "T", author: "A", year: 2023 },
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/must-read/preview");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      url: "https://example.com",
    });
  });

  it("returns extraction_failed payload", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ status: "extraction_failed", error: "timeout" }),
        { status: 200 },
      ),
    );
    const out = await previewMustRead({ url: "https://x.com" });
    expect(out).toEqual({ status: "extraction_failed", error: "timeout" });
  });
});

describe("createMustRead", () => {
  it("POSTs /api/admin/must-read and returns the created entry on 201", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(sampleEntry), { status: 201 }),
    );
    const out = await createMustRead({
      url: sampleEntry.url,
      title: sampleEntry.title,
      author: sampleEntry.author,
      year: sampleEntry.year,
      annotation: sampleEntry.annotation,
    });
    expect(out).toEqual(sampleEntry);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/must-read");
    expect(init.method).toBe("POST");
  });

  it("throws DuplicateUrlError on 409 with existingId", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: "duplicate_url",
          existingId: "22222222-2222-2222-2222-222222222222",
        }),
        { status: 409 },
      ),
    );
    await expect(
      createMustRead({
        url: "https://dup.com",
        title: "T",
        author: null,
        year: null,
        annotation: "A",
      }),
    ).rejects.toBeInstanceOf(DuplicateUrlError);
  });

  it("throws generic Error on non-409 failure", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "boom" }), { status: 500 }),
    );
    await expect(
      createMustRead({
        url: "https://x.com",
        title: "T",
        author: null,
        year: null,
        annotation: "A",
      }),
    ).rejects.toThrow("boom");
  });
});

describe("listAdminMustRead", () => {
  it("GETs /api/admin/must-read and returns AdminMustReadEntry[]", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([sampleEntry]), { status: 200 }),
    );
    const out = await listAdminMustRead();
    expect(out).toEqual([sampleEntry]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/must-read");
    expect(init.method ?? "GET").toBe("GET");
  });
});

describe("updateMustRead", () => {
  it("PATCHes /api/admin/must-read/:id with patch body", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(sampleEntry), { status: 200 }),
    );
    await updateMustRead(sampleEntry.id, { annotation: "Updated" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/admin/must-read/${sampleEntry.id}`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ annotation: "Updated" });
  });

  it("throws DuplicateUrlError on 409", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: "duplicate_url",
          existingId: "99999999-9999-9999-9999-999999999999",
        }),
        { status: 409 },
      ),
    );
    await expect(
      updateMustRead(sampleEntry.id, { url: "https://other.com" }),
    ).rejects.toBeInstanceOf(DuplicateUrlError);
  });
});

describe("deleteMustRead", () => {
  it("DELETEs /api/admin/must-read/:id", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await deleteMustRead(sampleEntry.id);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/admin/must-read/${sampleEntry.id}`);
    expect(init.method).toBe("DELETE");
  });

  it("throws on failure", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "not_found" }), { status: 404 }),
    );
    await expect(deleteMustRead(sampleEntry.id)).rejects.toThrow("not_found");
  });
});
