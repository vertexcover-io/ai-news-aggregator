import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import type { RankedItem } from "@newsletter/shared";
import { AddPostPanel } from "../../../../src/components/review/AddPostPanel";

vi.mock("../../../../src/api/archives", () => ({
  addPost: vi.fn(),
}));

import { addPost } from "../../../../src/api/archives";

function makeItem(): RankedItem {
  return {
    id: 99,
    rawItemId: 99,
    title: "New Post",
    url: "https://example.com/article",
    sourceType: "hn",
    author: null,
    publishedAt: null,
    engagement: { points: 0, commentCount: 0 },
    score: 1,
    rationale: "r",
    content: null,
    imageUrl: null,
    recap: null,
    enrichedSource: null,
  };
}

beforeEach(() => {
  vi.mocked(addPost).mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AddPostPanel", () => {
  it("REQ-020: renders no tabs, exactly 1 input, exactly 1 submit button, no HN/Reddit/Web tab labels", () => {
    render(
      <AddPostPanel
        runId="run-1"
        hasUrl={() => false}
        onPending={vi.fn()}
        onResolved={vi.fn()}
        onFailed={vi.fn()}
      />,
    );

    expect(screen.queryAllByRole("tab")).toHaveLength(0);

    const inputs = screen.getAllByRole("textbox");
    expect(inputs).toHaveLength(1);

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);

    expect(screen.queryByText("Hacker News")).toBeNull();
    expect(screen.queryByText("Reddit")).toBeNull();
    // "Web" as a tab trigger
    expect(
      screen.queryAllByRole("tab").filter((el) => el.textContent === "Web"),
    ).toHaveLength(0);
  });

  it("REQ-021: submitting a valid URL calls addPost with { url } and no sourceType", async () => {
    vi.mocked(addPost).mockResolvedValue(makeItem());
    const onPending = vi.fn();
    const onResolved = vi.fn();

    render(
      <AddPostPanel
        runId="run-1"
        hasUrl={() => false}
        onPending={onPending}
        onResolved={onResolved}
        onFailed={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Article URL"), {
      target: { value: "https://example.com/article" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add post/i }));

    expect(onPending).toHaveBeenCalledTimes(1);
    const pendingArg = onPending.mock.calls[0]?.[0] as { url: string };
    expect(pendingArg.url).toBe("https://example.com/article");
    expect(pendingArg).not.toHaveProperty("sourceType");

    await waitFor(() => {
      expect(onResolved).toHaveBeenCalledTimes(1);
    });

    expect(vi.mocked(addPost)).toHaveBeenCalledWith("run-1", {
      url: "https://example.com/article",
    });
    const callArg = vi.mocked(addPost).mock.calls[0]?.[1] as unknown as Record<
      string,
      unknown
    >;
    expect(callArg).not.toHaveProperty("sourceType");
  });

  it("EDGE-020: leading/trailing whitespace is trimmed before submission", async () => {
    vi.mocked(addPost).mockResolvedValue(makeItem());
    render(
      <AddPostPanel
        runId="run-1"
        hasUrl={() => false}
        onPending={vi.fn()}
        onResolved={vi.fn()}
        onFailed={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Article URL"), {
      target: { value: "  https://example.com/article  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /add post/i }));

    await waitFor(() => {
      expect(vi.mocked(addPost)).toHaveBeenCalledWith("run-1", {
        url: "https://example.com/article",
      });
    });
  });

  it("EDGE-021: submit button is disabled when input is empty", () => {
    render(
      <AddPostPanel
        runId="run-1"
        hasUrl={() => false}
        onPending={vi.fn()}
        onResolved={vi.fn()}
        onFailed={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: /add post/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("EDGE-021: submit button is disabled when URL is invalid", () => {
    render(
      <AddPostPanel
        runId="run-1"
        hasUrl={() => false}
        onPending={vi.fn()}
        onResolved={vi.fn()}
        onFailed={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Article URL"), {
      target: { value: "not-a-url" },
    });

    const button = screen.getByRole("button", { name: /add post/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows role='alert' with the server error message on failure", async () => {
    vi.mocked(addPost).mockRejectedValue(new Error("upstream failed"));
    const onFailed = vi.fn();
    render(
      <AddPostPanel
        runId="run-1"
        hasUrl={() => false}
        onPending={vi.fn()}
        onResolved={vi.fn()}
        onFailed={onFailed}
      />,
    );
    fireEvent.change(screen.getByLabelText("Article URL"), {
      target: { value: "https://example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add post/i }));
    await waitFor(() => {
      expect(onFailed).toHaveBeenCalledTimes(1);
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("upstream failed");
  });

  it("rejects duplicate URL client-side with exact copy 'This post is already in the list.' and makes no request", () => {
    const hasUrl = vi.fn(() => true);
    render(
      <AddPostPanel
        runId="run-1"
        hasUrl={hasUrl}
        onPending={vi.fn()}
        onResolved={vi.fn()}
        onFailed={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Article URL"), {
      target: { value: "https://already.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add post/i }));
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("This post is already in the list.");
    expect(vi.mocked(addPost)).not.toHaveBeenCalled();
  });
});
