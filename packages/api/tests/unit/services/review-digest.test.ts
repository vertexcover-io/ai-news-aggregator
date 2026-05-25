import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { generateReviewDigest } from "@api/services/review-digest.js";
import type { ReviewDigestItem } from "@api/services/review.js";

interface GenerateArgs {
  readonly model: unknown;
  readonly system: string;
  readonly prompt: string;
  readonly schema: z.ZodType;
  readonly temperature?: number;
  readonly maxRetries?: number;
  readonly abortSignal?: AbortSignal;
}

function makeItem(overrides: Partial<ReviewDigestItem> = {}): ReviewDigestItem {
  return {
    id: 1,
    title: "Final reviewed story",
    url: "https://example.com/story",
    sourceType: "hn",
    summary: "Final story summary",
    bullets: ["One concrete point"],
    bottomLine: "Important for builders.",
    ...overrides,
  };
}

describe("generateReviewDigest", () => {
  it("REQ-001/REQ-002/REQ-008: asks for issue-level copy from final reviewed items", async () => {
    const generateObject = vi.fn((args: GenerateArgs) => {
      expect(args.system).toContain("issue-level editorial copy");
      expect(args.temperature).toBe(0);
      expect(args.maxRetries).toBe(2);
      return Promise.resolve({
        object: {
          headline: "Generated issue headline",
          summary: "Generated issue summary.",
        },
      });
    });

    const result = await generateReviewDigest(
      [makeItem({ title: "Final reviewed story" })],
      { generateObject },
    );

    const prompt = generateObject.mock.calls[0]?.[0].prompt ?? "";
    expect(prompt).toContain("final reviewed issue");
    expect(prompt).toContain("Final reviewed story");
    expect(prompt).not.toContain("Removed story");
    expect(result).toEqual({
      headline: "Generated issue headline",
      summary: "Generated issue summary.",
    });
  });

  it("REQ-004: propagates provider failures", async () => {
    const generateObject = vi.fn((_args: GenerateArgs) =>
      Promise.reject(new Error("provider down")),
    );

    await expect(
      generateReviewDigest([makeItem()], { generateObject }),
    ).rejects.toThrow(/provider down/);
  });
});
