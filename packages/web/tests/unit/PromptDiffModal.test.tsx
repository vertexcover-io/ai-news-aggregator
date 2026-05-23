import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import {
  PromptDiffModal,
  diffLines,
} from "../../src/components/eval/PromptDiffModal";

afterEach(() => {
  cleanup();
});

describe("diffLines", () => {
  it("marks identical lines as same", () => {
    const out = diffLines("a\nb\nc", "a\nb\nc");
    expect(out.map((l) => l.type)).toEqual(["same", "same", "same"]);
  });

  it("marks an added line", () => {
    const out = diffLines("a\nc", "a\nb\nc");
    expect(out.map((l) => l.type)).toEqual(["same", "add", "same"]);
    expect(out[1]).toEqual({ type: "add", text: "b" });
  });

  it("marks a removed line", () => {
    const out = diffLines("a\nb\nc", "a\nc");
    expect(out.map((l) => l.type)).toEqual(["same", "remove", "same"]);
    expect(out[1]).toEqual({ type: "remove", text: "b" });
  });
});

describe("PromptDiffModal", () => {
  it("renders diff rows with markers and confirm/cancel", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <PromptDiffModal
        current={"line1\nold"}
        draft={"line1\nnew"}
        open={true}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    const body = screen.getByTestId("prompt-diff-body");
    expect(body.querySelector('[data-difftype="add"]')?.textContent).toContain(
      "new",
    );
    expect(
      body.querySelector('[data-difftype="remove"]')?.textContent,
    ).toContain("old");
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
