import { describe, expect, it, beforeEach } from "vitest";
import { setMeta } from "../../../src/lib/meta";

beforeEach(() => {
  document.head.querySelectorAll("meta").forEach((m) => {
    m.remove();
  });
});

describe("setMeta", () => {
  it.each([
    {
      desc: "creates a name= meta tag for non-og keys (REQ-fence)",
      key: "description",
      attr: "name",
      otherAttr: "property",
    },
    {
      desc: "creates a property= meta tag for og: keys (REQ-011)",
      key: "og:title",
      attr: "property",
      otherAttr: "name",
    },
  ])("$desc", ({ key, attr, otherAttr }) => {
    setMeta(key, "X");
    const matched = document.head.querySelector(`meta[${attr}="${key}"]`);
    const other = document.head.querySelector(`meta[${otherAttr}="${key}"]`);
    expect(matched?.getAttribute("content")).toBe("X");
    expect(other).toBeNull();
  });

  it.each([
    {
      desc: "updates the existing property= og: tag rather than creating a duplicate",
      key: "og:title",
      attr: "property",
    },
    {
      desc: "updates the existing name= description tag rather than duplicating",
      key: "description",
      attr: "name",
    },
  ])("$desc", ({ key, attr }) => {
    setMeta(key, "First");
    setMeta(key, "Second");
    const tags = document.head.querySelectorAll(`meta[${attr}="${key}"]`);
    expect(tags.length).toBe(1);
    expect(tags[0].getAttribute("content")).toBe("Second");
  });
});
