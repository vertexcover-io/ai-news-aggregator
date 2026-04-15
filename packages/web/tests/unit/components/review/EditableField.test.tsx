import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { EditableField } from "../../../../src/components/review/EditableField";

afterEach(() => {
  cleanup();
});

describe("EditableField", () => {
  it("renders value in read mode (REQ-006)", () => {
    render(
      <EditableField value="Hello world" onCommit={vi.fn()} />,
    );
    expect(screen.getByText("Hello world")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("clicking switches to input with the current value (REQ-006)", () => {
    render(
      <EditableField value="initial text" onCommit={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button"));
    const input = screen.getByRole("textbox");
    expect(input).toBeTruthy();
    expect(input).toHaveProperty("value", "initial text");
  });

  it("pressing Enter commits and returns to read mode (REQ-007)", () => {
    const onCommit = vi.fn();
    render(
      <EditableField value="original" onCommit={onCommit} />,
    );
    fireEvent.click(screen.getByRole("button"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "updated" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("updated");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("blur commits (REQ-007)", () => {
    const onCommit = vi.fn();
    render(
      <EditableField value="original" onCommit={onCommit} />,
    );
    fireEvent.click(screen.getByRole("button"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "blurred value" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith("blurred value");
  });

  it("Escape reverts to original value and exits editing (REQ-008)", () => {
    const onCommit = vi.fn();
    render(
      <EditableField value="original" onCommit={onCommit} />,
    );
    fireEvent.click(screen.getByRole("button"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "changed" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("original")).toBeTruthy();
  });

  it("pencil icon has aria-label='Edit' (REQ-018)", () => {
    render(
      <EditableField value="some text" onCommit={vi.fn()} />,
    );
    expect(screen.getByLabelText("Edit")).toBeTruthy();
  });

  it("renders multiline as textarea", () => {
    render(
      <EditableField value="multi line" onCommit={vi.fn()} multiline />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("textbox").tagName).toBe("TEXTAREA");
  });

  it("Tab key commits in single-line mode (REQ-007)", () => {
    const onCommit = vi.fn();
    render(
      <EditableField value="text" onCommit={onCommit} />,
    );
    fireEvent.click(screen.getByRole("button"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "tabbed" } });
    fireEvent.keyDown(input, { key: "Tab" });
    expect(onCommit).toHaveBeenCalledWith("tabbed");
  });

  it("renders placeholder when value is empty", () => {
    render(
      <EditableField value="" onCommit={vi.fn()} placeholder="Enter text..." />,
    );
    expect(screen.getByText("Enter text...")).toBeTruthy();
  });
});
