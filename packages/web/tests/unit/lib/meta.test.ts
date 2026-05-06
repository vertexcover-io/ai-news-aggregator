import { describe, expect, it, beforeEach } from "vitest";
import { setMeta } from "../../../src/lib/meta";

beforeEach(() => {
  document.head.querySelectorAll("meta").forEach((m) => {
    m.remove();
  });
});

describe("setMeta", () => {
  it("creates a name= meta tag for non-og keys (REQ-fence)", () => {
    setMeta("description", "X");
    const named = document.head.querySelector('meta[name="description"]');
    const propped = document.head.querySelector('meta[property="description"]');
    expect(named?.getAttribute("content")).toBe("X");
    expect(propped).toBeNull();
  });

  it("creates a property= meta tag for og: keys (REQ-011)", () => {
    setMeta("og:title", "X");
    const propped = document.head.querySelector('meta[property="og:title"]');
    const named = document.head.querySelector('meta[name="og:title"]');
    expect(propped?.getAttribute("content")).toBe("X");
    expect(named).toBeNull();
  });

  it("updates the existing property= og: tag rather than creating a duplicate", () => {
    setMeta("og:title", "First");
    setMeta("og:title", "Second");
    const tags = document.head.querySelectorAll('meta[property="og:title"]');
    expect(tags.length).toBe(1);
    expect(tags[0].getAttribute("content")).toBe("Second");
  });

  it("updates the existing name= description tag rather than duplicating", () => {
    setMeta("description", "A");
    setMeta("description", "B");
    const tags = document.head.querySelectorAll('meta[name="description"]');
    expect(tags.length).toBe(1);
    expect(tags[0].getAttribute("content")).toBe("B");
  });
});
