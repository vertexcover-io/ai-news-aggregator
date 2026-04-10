import { describe, it, expect } from "vitest";
import type {
  UserProfile,
  Candidate,
  RawItemComment,
  RawItemEngagement,
} from "@newsletter/shared/types";

// REQ-006, REQ-101: UserProfile lives in @newsletter/shared and is importable
describe("UserProfile", () => {
  it("accepts a profile with required name + topics and optional antiTopics", () => {
    const profile: UserProfile = {
      name: "aman",
      topics: ["agent frameworks", "rust"],
      antiTopics: ["crypto"],
    };
    expect(profile.name).toBe("aman");
    expect(profile.topics).toHaveLength(2);
    expect(profile.antiTopics).toEqual(["crypto"]);
  });

  it("accepts a profile with antiTopics omitted", () => {
    const profile: UserProfile = {
      name: "ritesh",
      topics: ["llm research"],
    };
    expect(profile.antiTopics).toBeUndefined();
  });
});

// REQ-011, REQ-101: Candidate lives in @newsletter/shared with content + comments
describe("Candidate", () => {
  it("exposes content (string | null) and comments (RawItemComment[])", () => {
    const engagement: RawItemEngagement = { points: 10, commentCount: 3 };
    const comments: RawItemComment[] = [
      {
        id: "c1",
        author: "alice",
        content: "great article",
        publishedAt: "2026-04-01T00:00:00Z",
      },
    ];
    const candidate: Candidate = {
      id: 1,
      title: "Example",
      url: "https://example.com",
      sourceType: "hn",
      author: "bob",
      publishedAt: new Date("2026-04-01T00:00:00Z"),
      engagement,
      content: "body markdown",
      comments,
    };
    expect(candidate.content).toBe("body markdown");
    expect(candidate.comments).toHaveLength(1);
  });

  it("allows content to be null and comments to be empty", () => {
    const candidate: Candidate = {
      id: 2,
      title: "No body",
      url: "https://example.com/2",
      sourceType: "reddit",
      author: null,
      publishedAt: null,
      engagement: { points: 0, commentCount: 0 },
      content: null,
      comments: [],
    };
    expect(candidate.content).toBeNull();
    expect(candidate.comments).toEqual([]);
  });
});
