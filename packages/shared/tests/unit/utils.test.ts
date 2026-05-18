import { describe, it, expect } from "vitest";
import { detectAddPostSourceType } from "@shared/utils/index.js";

describe("detectAddPostSourceType", () => {
  it("returns hn for a Hacker News item URL with numeric id", () => {
    expect(
      detectAddPostSourceType("https://news.ycombinator.com/item?id=12345"),
    ).toBe("hn");
  });

  it("returns hn for an hn.algolia.com URL with a story hash matching the pattern", () => {
    // Hash must match /story/<slug>/<numeric-segment>/<numeric-id>
    expect(
      detectAddPostSourceType(
        "https://hn.algolia.com/api/v1/items/12345#/story/foo/123/45678",
      ),
    ).toBe("hn");
  });

  it("returns reddit for a www.reddit.com post URL", () => {
    expect(
      detectAddPostSourceType(
        "https://www.reddit.com/r/MachineLearning/comments/abc123/some_title/",
      ),
    ).toBe("reddit");
  });

  it("returns reddit for an old.reddit.com post URL", () => {
    expect(
      detectAddPostSourceType(
        "https://old.reddit.com/r/MachineLearning/comments/abc123/some_title/",
      ),
    ).toBe("reddit");
  });

  it("returns web for an unrecognised domain", () => {
    expect(detectAddPostSourceType("https://example.com/article")).toBe("web");
  });

  it("returns web for an invalid URL string without throwing", () => {
    expect(detectAddPostSourceType("not-a-url")).toBe("web");
  });

  it("returns web for a Hacker News item URL with no id param", () => {
    expect(
      detectAddPostSourceType("https://news.ycombinator.com/item"),
    ).toBe("web");
  });

  it("returns web for a Hacker News item URL with a non-numeric id param", () => {
    expect(
      detectAddPostSourceType(
        "https://news.ycombinator.com/item?id=notanumber",
      ),
    ).toBe("web");
  });
});
