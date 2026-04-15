import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { EditableBulletList } from "../../../../src/components/review/EditableBulletList";

afterEach(() => {
  cleanup();
});

describe("EditableBulletList", () => {
  it("renders bullet list in read mode (REQ-010)", () => {
    render(
      <EditableBulletList
        bullets={["First bullet", "Second bullet"]}
        onCommit={vi.fn()}
      />,
    );
    expect(screen.getByText("First bullet")).toBeTruthy();
    expect(screen.getByText("Second bullet")).toBeTruthy();
  });

  it("clicking a bullet switches to input (REQ-010)", () => {
    render(
      <EditableBulletList bullets={["Click me"]} onCommit={vi.fn()} />,
    );
    fireEvent.click(screen.getByText("Click me"));
    const input = screen.getByRole("textbox");
    expect(input).toHaveProperty("value", "Click me");
  });

  it("confirming edit with Enter updates the bullet (REQ-011)", () => {
    const onCommit = vi.fn();
    render(
      <EditableBulletList bullets={["original"]} onCommit={onCommit} />,
    );
    fireEvent.click(screen.getByText("original"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "updated" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith(["updated"]);
  });

  it("delete button removes the bullet (REQ-012)", () => {
    const onCommit = vi.fn();
    render(
      <EditableBulletList
        bullets={["keep", "remove me"]}
        onCommit={onCommit}
      />,
    );
    fireEvent.click(screen.getByLabelText("Delete bullet 2"));
    expect(onCommit).toHaveBeenCalledWith(["keep"]);
  });

  it("'+ Add bullet' button appears (REQ-013)", () => {
    render(
      <EditableBulletList bullets={["one"]} onCommit={vi.fn()} />,
    );
    expect(screen.getByText(/Add bullet/)).toBeTruthy();
  });

  it("clicking 'Add bullet' shows input and confirming non-empty text appends (REQ-014)", () => {
    const onCommit = vi.fn();
    render(
      <EditableBulletList bullets={["existing"]} onCommit={onCommit} />,
    );
    fireEvent.click(screen.getByText(/Add bullet/));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "new bullet" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith(["existing", "new bullet"]);
  });

  it("Escape on new bullet discards it without calling onCommit (EDGE-004)", () => {
    const onCommit = vi.fn();
    render(
      <EditableBulletList bullets={["one"]} onCommit={onCommit} />,
    );
    fireEvent.click(screen.getByText(/Add bullet/));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "something" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("confirming empty new bullet discards it without appending (EDGE-005)", () => {
    const onCommit = vi.fn();
    render(
      <EditableBulletList bullets={["one"]} onCommit={onCommit} />,
    );
    fireEvent.click(screen.getByText(/Add bullet/));
    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("pencil icon on a bullet has correct aria-label (REQ-018)", () => {
    render(
      <EditableBulletList bullets={["first"]} onCommit={vi.fn()} />,
    );
    expect(screen.getByLabelText("Edit bullet 1")).toBeTruthy();
  });
});
