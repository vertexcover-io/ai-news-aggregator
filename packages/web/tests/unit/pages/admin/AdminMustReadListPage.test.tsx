import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import type { AdminMustReadEntry } from "@newsletter/shared/types";
import { AdminMustReadListPage } from "../../../../src/pages/admin/AdminMustReadListPage";

vi.mock("../../../../src/api/must-read", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../src/api/must-read")
  >("../../../../src/api/must-read");
  return {
    ...actual,
    listAdminMustRead: vi.fn(),
    deleteMustRead: vi.fn(),
  };
});

import {
  deleteMustRead,
  listAdminMustRead,
} from "../../../../src/api/must-read";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  vi.mocked(listAdminMustRead).mockReset();
  vi.mocked(deleteMustRead).mockReset();
});

function makeEntry(
  overrides: Partial<AdminMustReadEntry> = {},
): AdminMustReadEntry {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    url: "https://example.com/post",
    title: "Attention is All You Need",
    author: "Vaswani",
    year: 2017,
    annotation: "Seminal transformer paper that shaped modern LLMs.",
    addedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
    ...overrides,
  };
}

function renderPage(): ReturnType<typeof render> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const router = createMemoryRouter(
    [
      { path: "/admin/must-read", element: <AdminMustReadListPage /> },
      { path: "/admin/must-read/new", element: <div>NEW PAGE</div> },
      { path: "/admin/must-read/:id", element: <div>EDIT PAGE</div> },
    ],
    { initialEntries: ["/admin/must-read"] },
  );
  const tree: ReactElement = (
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return render(tree);
}

describe("AdminMustReadListPage (REQ-028)", () => {
  it("renders an Add CTA linking to /admin/must-read/new and one row per entry", async () => {
    vi.mocked(listAdminMustRead).mockResolvedValue([
      makeEntry({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", title: "First" }),
      makeEntry({ id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", title: "Second" }),
    ]);
    renderPage();
    await screen.findByText("First");
    expect(screen.getByText("Second")).toBeTruthy();
    const addLink = screen.getByRole("link", { name: /add new/i });
    expect(addLink.getAttribute("href")).toBe("/admin/must-read/new");
  });

  it("renders an empty state when no entries exist", async () => {
    vi.mocked(listAdminMustRead).mockResolvedValue([]);
    renderPage();
    await screen.findByText(/no must-read entries/i);
  });

  it("links each row's Edit button to /admin/must-read/<id>", async () => {
    const entry = makeEntry();
    vi.mocked(listAdminMustRead).mockResolvedValue([entry]);
    renderPage();
    await screen.findByText(entry.title);
    const editLink = screen.getByRole("link", { name: /edit/i });
    expect(editLink.getAttribute("href")).toBe(
      `/admin/must-read/${entry.id}`,
    );
  });

  it("deletes an entry after confirmation", async () => {
    const entry = makeEntry();
    vi.mocked(listAdminMustRead).mockResolvedValue([entry]);
    vi.mocked(deleteMustRead).mockResolvedValue();
    renderPage();
    await screen.findByText(entry.title);

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const deleteBtn = screen.getByRole("button", { name: /delete/i });
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(vi.mocked(deleteMustRead)).toHaveBeenCalledWith(entry.id);
    });
    confirmSpy.mockRestore();
  });

  it("does not delete when confirmation is dismissed", async () => {
    const entry = makeEntry();
    vi.mocked(listAdminMustRead).mockResolvedValue([entry]);
    renderPage();
    await screen.findByText(entry.title);

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));

    expect(vi.mocked(deleteMustRead)).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
