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
    url: "https://news.ycombinator.com/item?id=1",
    sourceType: "hn",
    author: null,
    publishedAt: null,
    engagement: { points: 0, commentCount: 0 },
    score: 1,
    rationale: "r",
    content: null,
    imageUrl: null,
    recap: null,
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
  it("submits URL + sourceType, calls onPending then onResolved (REQ-131, REQ-132, REQ-133)", async () => {
    vi.mocked(addPost).mockResolvedValue(makeItem());
    const onPending = vi.fn();
    const onResolved = vi.fn();
    const onFailed = vi.fn();
    render(
      <AddPostPanel
        runId="run-1"
        hasUrl={() => false}
        onPending={onPending}
        onResolved={onResolved}
        onFailed={onFailed}
      />,
    );
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://news.ycombinator.com/item?id=1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /fetch/i }));
    expect(onPending).toHaveBeenCalledTimes(1);
    const pendingArg = onPending.mock.calls[0]?.[0] as {
      sourceType: string;
      url: string;
    };
    expect(pendingArg.sourceType).toBe("hn");
    expect(pendingArg.url).toBe("https://news.ycombinator.com/item?id=1");
    await waitFor(() => {
      expect(onResolved).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(addPost)).toHaveBeenCalledWith("run-1", {
      sourceType: "hn",
      url: "https://news.ycombinator.com/item?id=1",
    });
  });

  it("shows role='alert' with the server error message on failure (REQ-134)", async () => {
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
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://x.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /fetch/i }));
    await waitFor(() => {
      expect(onFailed).toHaveBeenCalledTimes(1);
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("upstream failed");
  });

  it("rejects duplicate URL client-side with exact copy 'This post is already in the list.' and makes no request (REQ-135)", () => {
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
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://already.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /fetch/i }));
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("This post is already in the list.");
    expect(vi.mocked(addPost)).not.toHaveBeenCalled();
  });
});
