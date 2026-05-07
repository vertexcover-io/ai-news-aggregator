import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ResultMeta } from "../../../../src/components/archive-listing/ResultMeta";

afterEach(cleanup);

describe("ResultMeta", () => {
  it("renders 'N issues match \"q\"' when no range is provided", () => {
    render(<ResultMeta count={7} q="agentic" />);
    expect(screen.getByText("7 issues")).toBeTruthy();
    expect(screen.getByText(/match\s+"agentic"/)).toBeTruthy();
  });

  it("renders the range string after a middle dot when provided", () => {
    render(<ResultMeta count={3} q="anthropic" rangeLabel="Apr 1 – Apr 30" />);
    expect(screen.getByText(/·\s*Apr 1 – Apr 30/)).toBeTruthy();
  });

  it("EDGE-019: q is React-escaped (no <script> element rendered)", () => {
    render(<ResultMeta count={1} q='<script>alert(1)</script>' />);
    expect(document.querySelector("script")).toBeNull();
    expect(document.body.textContent).toContain('"<script>alert(1)</script>"');
  });

  it("uses singular 'issue' when count is 1", () => {
    render(<ResultMeta count={1} q="foo" />);
    expect(screen.getByText("1 issue")).toBeTruthy();
  });
});
