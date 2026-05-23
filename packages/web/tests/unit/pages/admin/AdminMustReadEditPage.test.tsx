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
import { AdminMustReadEditPage } from "../../../../src/pages/admin/AdminMustReadEditPage";
import { DuplicateUrlError } from "../../../../src/api/must-read";

vi.mock("../../../../src/api/must-read", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../src/api/must-read")
  >("../../../../src/api/must-read");
  return {
    ...actual,
    previewMustRead: vi.fn(),
    createMustRead: vi.fn(),
    listAdminMustRead: vi.fn(),
    updateMustRead: vi.fn(),
  };
});

import {
  createMustRead,
  listAdminMustRead,
  previewMustRead,
  updateMustRead,
} from "../../../../src/api/must-read";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  vi.mocked(previewMustRead).mockReset();
  vi.mocked(createMustRead).mockReset();
  vi.mocked(listAdminMustRead).mockReset();
  vi.mocked(updateMustRead).mockReset();
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
    annotation: "Seminal transformer paper.",
    addedAt: "2025-11-01T00:00:00Z",
    updatedAt: "2025-11-02T00:00:00Z",
    ...overrides,
  };
}

function renderEditPage(path: string): ReturnType<typeof render> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const router = createMemoryRouter(
    [
      { path: "/admin/must-read", element: <div>LIST PAGE</div> },
      { path: "/admin/must-read/new", element: <AdminMustReadEditPage /> },
      { path: "/admin/must-read/:id", element: <AdminMustReadEditPage /> },
    ],
    { initialEntries: [path] },
  );
  const tree: ReactElement = (
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return render(tree);
}

describe("AdminMustReadEditPage — create flow (REQ-029)", () => {
  it("disables Save while previewing and prefills fields on extracted", async () => {
    const resolveRef: { current: (() => void) | null } = { current: null };
    vi.mocked(previewMustRead).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRef.current = (): void => {
            resolve({
              status: "extracted",
              suggested: {
                title: "Suggested title",
                author: "Suggested Author",
                year: 2024,
              },
            });
          };
        }),
    );

    renderEditPage("/admin/must-read/new");

    const urlInput = await screen.findByLabelText(/^url$/i);
    fireEvent.change(urlInput, {
      target: { value: "https://example.com/article" },
    });
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));

    await screen.findByText(/extracting/i);
    const saveBtn = screen.getByRole("button", { name: /^save$/i });
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true);

    resolveRef.current?.();

    await waitFor(() => {
      const titleInput = screen.getByLabelText(/^title$/i);
      expect((titleInput as HTMLInputElement).value).toBe("Suggested title");
    });
    const authorInput = screen.getByLabelText(/^author$/i);
    const yearInput = screen.getByLabelText(/^year$/i);
    expect((authorInput as HTMLInputElement).value).toBe("Suggested Author");
    expect((yearInput as HTMLInputElement).value).toBe("2024");
  });

  it("renders 'Extraction failed' banner on extraction_failed and leaves fields empty (REQ-030)", async () => {
    vi.mocked(previewMustRead).mockResolvedValue({
      status: "extraction_failed",
      error: "timeout",
    });

    renderEditPage("/admin/must-read/new");
    const urlInput = await screen.findByLabelText(/^url$/i);
    fireEvent.change(urlInput, { target: { value: "https://example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));

    await screen.findByText(/Extraction failed: timeout. Enter manually\./i);
    const titleInput = screen.getByLabelText(/^title$/i);
    const authorInput = screen.getByLabelText(/^author$/i);
    const yearInput = screen.getByLabelText(/^year$/i);
    expect((titleInput as HTMLInputElement).value).toBe("");
    expect((authorInput as HTMLInputElement).value).toBe("");
    expect((yearInput as HTMLInputElement).value).toBe("");
  });

  it("prefills only title when author/year are null (EDGE-003)", async () => {
    vi.mocked(previewMustRead).mockResolvedValue({
      status: "extracted",
      suggested: { title: "X", author: null, year: null },
    });
    renderEditPage("/admin/must-read/new");
    fireEvent.change(await screen.findByLabelText(/^url$/i), {
      target: { value: "https://x.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));

    await waitFor(() => {
      const titleInput = screen.getByLabelText(/^title$/i);
      expect((titleInput as HTMLInputElement).value).toBe("X");
    });
    const authorInput = screen.getByLabelText(/^author$/i);
    const yearInput = screen.getByLabelText(/^year$/i);
    expect((authorInput as HTMLInputElement).value).toBe("");
    expect((yearInput as HTMLInputElement).value).toBe("");
  });

  it("shows duplicate-URL inline message with link on 409 (REQ-031 / EDGE-006)", async () => {
    vi.mocked(previewMustRead).mockResolvedValue({
      status: "extracted",
      suggested: { title: "Dup title", author: null, year: null },
    });
    const existingId = "22222222-2222-2222-2222-222222222222";
    vi.mocked(createMustRead).mockRejectedValue(
      new DuplicateUrlError(existingId),
    );

    renderEditPage("/admin/must-read/new");
    fireEvent.change(await screen.findByLabelText(/^url$/i), {
      target: { value: "https://dup.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));

    await waitFor(() => {
      const titleInput = screen.getByLabelText(/^title$/i);
      expect((titleInput as HTMLInputElement).value).toBe("Dup title");
    });

    fireEvent.change(screen.getByLabelText(/^annotation$/i), {
      target: { value: "An annotation." },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await screen.findByText(/URL already exists/i);
    const link = screen.getByRole("link", { name: /view existing entry/i });
    expect(link.getAttribute("href")).toBe(
      `/admin/must-read/${existingId}`,
    );
  });
});

describe("AdminMustReadEditPage — edit flow (EDGE-009)", () => {
  it("loads entry, updates annotation, and PATCHes without addedAt", async () => {
    const entry = makeEntry();
    vi.mocked(listAdminMustRead).mockResolvedValue([entry]);
    vi.mocked(updateMustRead).mockResolvedValue({
      ...entry,
      annotation: "Updated annotation.",
      updatedAt: "2026-05-01T00:00:00Z",
    });

    renderEditPage(`/admin/must-read/${entry.id}`);

    await waitFor(() => {
      const annotation = screen.getByLabelText(/^annotation$/i);
      expect((annotation as HTMLTextAreaElement).value).toBe(entry.annotation);
    });

    fireEvent.change(screen.getByLabelText(/^annotation$/i), {
      target: { value: "Updated annotation." },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(vi.mocked(updateMustRead)).toHaveBeenCalled();
    });
    const [calledId, patch] = vi.mocked(updateMustRead).mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(calledId).toBe(entry.id);
    expect(patch).not.toHaveProperty("addedAt");
    expect(patch.annotation).toBe("Updated annotation.");
  });
});
