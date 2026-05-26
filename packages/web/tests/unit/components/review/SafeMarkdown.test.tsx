import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SafeMarkdown } from "../../../../src/components/review/SafeMarkdown";

afterEach(() => {
  cleanup();
});

describe("SafeMarkdown", () => {
  it("REQ-021: renders markdown bold text as strong element", () => {
    render(<SafeMarkdown markdown="**bold text**" />);
    const strong = document.querySelector("strong");
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe("bold text");
  });

  it("REQ-021: renders markdown heading as h1 element", () => {
    render(<SafeMarkdown markdown="# Heading One" />);
    const h1 = document.querySelector("h1");
    expect(h1).not.toBeNull();
    expect(h1?.textContent).toBe("Heading One");
  });

  it("REQ-021: renders markdown links as anchor elements", () => {
    render(<SafeMarkdown markdown="[click me](https://example.com)" />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.textContent).toBe("click me");
  });

  it("REQ-021: renders markdown list items", () => {
    render(<SafeMarkdown markdown={`- item one\n- item two`} />);
    const items = screen.getAllByRole("listitem");
    expect(items.length).toBe(2);
    expect(items[0]?.textContent).toBe("item one");
    expect(items[1]?.textContent).toBe("item two");
  });

  it("EDGE-008: strips <script> tags (XSS prevention)", () => {
    const hostile = '<script>window.__xss = true</script>plain text';
    const { container } = render(<SafeMarkdown markdown={hostile} />);
    expect(container.querySelector("script")).toBeNull();
    expect((window as unknown as Record<string, unknown>).__xss).toBeUndefined();
  });

  it("EDGE-008: strips onerror attribute from img tags", () => {
    const hostile = '<img src="x" onerror="window.__xss2=true" />';
    const { container } = render(<SafeMarkdown markdown={hostile} />);
    const img = container.querySelector("img");
    // Either no img (stripped) or img without onerror
    if (img) {
      expect(img.getAttribute("onerror")).toBeNull();
    }
    expect((window as unknown as Record<string, unknown>).__xss2).toBeUndefined();
  });

  it("EDGE-008: strips javascript: href from anchor tags", () => {
    const hostile = '<a href="javascript:alert(1)">click</a>';
    const { container } = render(<SafeMarkdown markdown={hostile} />);
    const link = container.querySelector("a");
    if (link) {
      const href = link.getAttribute("href") ?? "";
      expect(href.toLowerCase().startsWith("javascript:")).toBe(false);
    }
  });

  it("renders empty string without crashing", () => {
    const { container } = render(<SafeMarkdown markdown="" />);
    expect(container).toBeTruthy();
  });
});
