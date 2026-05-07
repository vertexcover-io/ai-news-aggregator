import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { EmptyResults } from "../../../../src/components/archive-listing/EmptyResults";

afterEach(cleanup);

describe("EmptyResults", () => {
  it("renders the NO MATCHES eyebrow", () => {
    render(<EmptyResults q="agentic" />);
    expect(screen.getByText("NO MATCHES")).toBeTruthy();
  });

  it("renders the headline with the escaped query", () => {
    render(<EmptyResults q="agentic" />);
    expect(screen.getByText('Nothing in the archive matched "agentic".')).toBeTruthy();
  });

  it("renders the hint text", () => {
    render(<EmptyResults q="agentic" />);
    expect(
      screen.getByText("Try a shorter query, a source name, or an author handle."),
    ).toBeTruthy();
  });

  it("EDGE-019: q is React-escaped (no <script> element)", () => {
    render(<EmptyResults q="<script>alert(1)</script>" />);
    expect(document.querySelector("script")).toBeNull();
    expect(document.body.textContent).toContain('"<script>alert(1)</script>"');
  });
});
