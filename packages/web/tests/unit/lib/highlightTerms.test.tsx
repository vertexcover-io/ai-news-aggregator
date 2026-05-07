import { describe, expect, it, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { ReactElement } from "react";
import { highlightTerms } from "../../../src/lib/highlightTerms";

afterEach(cleanup);

function renderFragments(nodes: ReturnType<typeof highlightTerms>): ReturnType<typeof render> {
  const ui: ReactElement = <div data-testid="out">{nodes}</div>;
  return render(ui);
}

describe("highlightTerms", () => {
  it("returns the original text when terms is empty", () => {
    const out = highlightTerms("hello world", []);
    const { getByTestId } = renderFragments(out);
    expect(getByTestId("out").textContent).toBe("hello world");
    expect(getByTestId("out").querySelector("mark")).toBeNull();
  });

  it("returns the original text when input text is empty", () => {
    const out = highlightTerms("", ["foo"]);
    const { getByTestId } = renderFragments(out);
    expect(getByTestId("out").textContent).toBe("");
    expect(getByTestId("out").querySelector("mark")).toBeNull();
  });

  it("wraps a single term match in <mark>", () => {
    const out = highlightTerms("teams plan agentic workloads today", ["agentic"]);
    const { getByTestId } = renderFragments(out);
    const marks = getByTestId("out").querySelectorAll("mark");
    expect(marks.length).toBe(1);
    expect(marks[0].textContent).toBe("agentic");
  });

  it("is case-insensitive", () => {
    const out = highlightTerms("Agentic systems and AGENTIC pipelines", ["agentic"]);
    const { getByTestId } = renderFragments(out);
    const marks = getByTestId("out").querySelectorAll("mark");
    expect(marks.length).toBe(2);
    expect(marks[0].textContent).toBe("Agentic");
    expect(marks[1].textContent).toBe("AGENTIC");
  });

  it("escapes regex special chars in the term", () => {
    const out = highlightTerms("price is $5.00 today", ["$5.00"]);
    const { getByTestId } = renderFragments(out);
    const marks = getByTestId("out").querySelectorAll("mark");
    expect(marks.length).toBe(1);
    expect(marks[0].textContent).toBe("$5.00");
  });

  it("filters out empty terms gracefully", () => {
    const out = highlightTerms("foo bar baz", ["", "  "]);
    const { getByTestId } = renderFragments(out);
    expect(getByTestId("out").querySelector("mark")).toBeNull();
    expect(getByTestId("out").textContent).toBe("foo bar baz");
  });

  it("renders <script> as text, never as HTML", () => {
    const out = highlightTerms("<script>alert(1)</script> hi", ["hi"]);
    const { getByTestId } = renderFragments(out);
    const root = getByTestId("out");
    expect(root.querySelector("script")).toBeNull();
    expect(root.textContent).toContain("<script>alert(1)</script>");
  });
});
