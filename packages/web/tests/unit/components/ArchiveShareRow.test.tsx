import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ArchiveShareRow } from "../../../src/components/ArchiveShareRow";

vi.mock("../../../src/lib/analytics", () => ({
  captureBrowserEvent: vi.fn(),
}));

import { captureBrowserEvent } from "../../../src/lib/analytics";
const mockCaptureBrowserEvent = vi.mocked(captureBrowserEvent);

const ARCHIVE_URL = "https://example.com/archive/abc";
const SHARE_TEXT = "AI news - May 6, 2026";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ArchiveShareRow", () => {
  it("renders three controls inside a tagged container (REQ-001)", () => {
    render(<ArchiveShareRow archiveUrl={ARCHIVE_URL} shareText={SHARE_TEXT} />);
    const container = screen.getByTestId("archive-share-row");
    expect(container).toBeTruthy();
    expect(container.querySelector('[data-share-target="linkedin"]')).toBeTruthy();
    expect(container.querySelector('[data-share-target="x"]')).toBeTruthy();
    expect(container.querySelector('[data-share-target="copy"]')).toBeTruthy();
  });

  it("LinkedIn anchor has correct href, target, rel, aria-label (REQ-003, REQ-008)", () => {
    render(<ArchiveShareRow archiveUrl={ARCHIVE_URL} shareText={SHARE_TEXT} />);
    const a = screen.getByRole("link", { name: "Share this issue on LinkedIn" });
    expect(a.tagName).toBe("A");
    expect(a.getAttribute("href")).toBe(
      "https://www.linkedin.com/sharing/share-offsite/?url=https%3A%2F%2Fexample.com%2Farchive%2Fabc",
    );
    expect(a.getAttribute("target")).toBe("_blank");
    const rel = a.getAttribute("rel") ?? "";
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
    expect(a.getAttribute("data-share-target")).toBe("linkedin");
  });

  it("X anchor has correct href, target, rel, aria-label (REQ-004)", () => {
    render(<ArchiveShareRow archiveUrl={ARCHIVE_URL} shareText={SHARE_TEXT} />);
    const a = screen.getByRole("link", { name: "Share this issue on X" });
    expect(a.tagName).toBe("A");
    expect(a.getAttribute("href")).toBe(
      "https://twitter.com/intent/tweet?text=AI%20news%20-%20May%206%2C%202026&url=https%3A%2F%2Fexample.com%2Farchive%2Fabc",
    );
    expect(a.getAttribute("target")).toBe("_blank");
    const rel = a.getAttribute("rel") ?? "";
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
    expect(a.getAttribute("data-share-target")).toBe("x");
  });

  it("Copy button has correct shape and default label (REQ-007)", () => {
    render(<ArchiveShareRow archiveUrl={ARCHIVE_URL} shareText={SHARE_TEXT} />);
    const btn = screen.getByRole("button", { name: "Copy archive link" });
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.getAttribute("data-share-target")).toBe("copy");
    expect(btn.textContent?.replace(/\s+/g, " ").trim()).toBe("COPY LINK");
  });

  it("primary clipboard path: writeText called, label flips to COPIED ✓ then back to COPY LINK after 1500ms (REQ-009, REQ-012)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(<ArchiveShareRow archiveUrl={ARCHIVE_URL} shareText={SHARE_TEXT} />);
    const btn = screen.getByRole("button", { name: "Copy archive link" });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(btn.textContent?.replace(/\s+/g, " ").trim()).toBe("COPIED ✓");
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(ARCHIVE_URL);
    expect(mockCaptureBrowserEvent).toHaveBeenCalledWith(
      "archive_share_clicked",
      { target: "copy", run_id: undefined },
    );

    const live = document.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe("Copied");

    await waitFor(
      () => {
        expect(btn.textContent?.replace(/\s+/g, " ").trim()).toBe("COPY LINK");
      },
      { timeout: 2000 },
    );
  });

  it("execCommand fallback path: copies via textarea select (REQ-013)", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", {
      value: execCommand,
      configurable: true,
    });

    render(<ArchiveShareRow archiveUrl={ARCHIVE_URL} shareText={SHARE_TEXT} />);
    const btn = screen.getByRole("button", { name: "Copy archive link" });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(btn.textContent?.replace(/\s+/g, " ").trim()).toBe("COPIED ✓");
    });
    expect(execCommand).toHaveBeenCalledWith("copy");
    // No orphan textarea
    expect(document.querySelectorAll("textarea").length).toBe(0);
  });

  it("double failure: clipboard undefined and execCommand returns false → COPY FAILED (REQ-014)", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    const execCommand = vi.fn(() => false);
    Object.defineProperty(document, "execCommand", {
      value: execCommand,
      configurable: true,
    });

    render(<ArchiveShareRow archiveUrl={ARCHIVE_URL} shareText={SHARE_TEXT} />);
    const btn = screen.getByRole("button", { name: "Copy archive link" });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(btn.textContent?.replace(/\s+/g, " ").trim()).toBe("COPY FAILED");
    });
  });

  it("after successful copy, polite live region contains 'Copied'", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<ArchiveShareRow archiveUrl={ARCHIVE_URL} shareText={SHARE_TEXT} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy archive link" }));
    await waitFor(() => {
      const live = document.querySelector('[aria-live="polite"]');
      expect(live?.textContent).toBe("Copied");
    });
  });
});
