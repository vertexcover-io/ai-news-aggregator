import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { PublicMustReadEntry } from "@newsletter/shared/types";
import { MustReadPage } from "../../../src/pages/MustReadPage";
import { PublicLayout } from "../../../src/layouts/PublicLayout";

vi.mock("../../../src/api/must-read", () => ({
  listMustRead: vi.fn(),
}));

vi.mock("../../../src/api/subscribe", () => ({
  postSubscribe: vi.fn(),
}));

vi.mock("../../../src/lib/analytics", () => ({
  captureBrowserEvent: vi.fn(),
}));

import { listMustRead } from "../../../src/api/must-read";
const mockList = vi.mocked(listMustRead);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeEntry(
  id: string,
  addedAt: string,
  overrides: Partial<PublicMustReadEntry> = {},
): PublicMustReadEntry {
  return {
    id,
    url: `https://example.com/${id}`,
    title: `Title ${id}`,
    author: "Some Author",
    year: 2025,
    annotation: `Note for ${id}`,
    addedAt,
    ...overrides,
  };
}

function renderPage(entries: PublicMustReadEntry[]): ReturnType<typeof render> {
  mockList.mockResolvedValue(entries);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  qc.setQueryData(["must-read", "list"], entries);
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/must-read"]}>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route path="/must-read" element={<MustReadPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("MustReadPage", () => {
  it("REQ-011: renders headline and sub-deck literals", () => {
    renderPage([]);
    expect(screen.getByRole("heading", { level: 1, name: "Must Read" })).toBeTruthy();
    expect(
      screen.getByText(
        /seminal reading on agentic coding, harness engineering, and the software factory\. Annotated and kept current\./,
      ),
    ).toBeTruthy();
  });

  it("REQ-011: masthead nav contains Must Read · Sources · Built · Subscribe", () => {
    renderPage([]);
    const nav = document.querySelector('nav[aria-label="Primary"]');
    expect(nav).not.toBeNull();
    const text = nav?.textContent ?? "";
    for (const label of ["Must Read", "Sources", "Built", "Subscribe"]) {
      expect(text).toContain(label);
    }
    expect(text).not.toContain("RSS");
    // The legacy DirectoryNav is gone; no second nav row exists.
    expect(document.querySelector('nav[aria-label="Directory"]')).toBeNull();
  });

  it("REQ-012: entries render in addedAt DESC order", async () => {
    const entries = [
      makeEntry("a", "2026-05-01T00:00:00Z"),
      makeEntry("b", "2026-05-14T00:00:00Z"),
      makeEntry("c", "2026-04-21T00:00:00Z"),
    ];
    renderPage(entries);
    await waitFor(() => {
      const items = document.querySelectorAll("[data-entry-id]");
      expect(items.length).toBe(3);
    });
    const items = Array.from(document.querySelectorAll("[data-entry-id]"));
    expect(items.map((el) => el.getAttribute("data-entry-id"))).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("REQ-012: each entry's source link has rel and target attributes", async () => {
    const entries = [
      makeEntry("a", "2026-05-01T00:00:00Z"),
      makeEntry("b", "2026-05-14T00:00:00Z"),
      makeEntry("c", "2026-04-21T00:00:00Z"),
    ];
    renderPage(entries);
    await waitFor(() => {
      expect(document.querySelectorAll("[data-entry-id]").length).toBe(3);
    });
    const sourceLinks = document.querySelectorAll(
      "[data-entry-id] a[href^='http']",
    );
    expect(sourceLinks.length).toBe(3);
    for (const link of Array.from(sourceLinks)) {
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
      expect(link.getAttribute("target")).toBe("_blank");
    }
  });

  it("REQ-013: exactly 2 inline-subscribe sections render", async () => {
    renderPage([makeEntry("a", "2026-05-01T00:00:00Z")]);
    await waitFor(() => {
      expect(document.querySelectorAll("[data-entry-id]").length).toBe(1);
    });
    const cards = document.querySelectorAll('[data-section="inline-subscribe"]');
    expect(cards.length).toBe(2);
  });

  it("REQ-016: empty list renders meta line containing '0 entries' and both subscribe cards", async () => {
    renderPage([]);
    await waitFor(() => {
      const cards = document.querySelectorAll('[data-section="inline-subscribe"]');
      expect(cards.length).toBe(2);
    });
    const allText = document.body.textContent ?? "";
    expect(allText).toContain("0 entries");
  });

  it("EDGE-012: source link rel/target are canonical regardless of payload (no override path exists)", async () => {
    // The component sets rel/target literally; this asserts no payload field overrides them.
    renderPage([makeEntry("x", "2026-05-14T00:00:00Z")]);
    await waitFor(() => {
      expect(document.querySelectorAll("[data-entry-id]").length).toBe(1);
    });
    const link = document.querySelector("[data-entry-id] a[href^='http']");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link?.getAttribute("target")).toBe("_blank");
  });
});
