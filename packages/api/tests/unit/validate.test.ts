import { describe, it, expect } from "vitest";
import { runSubmitSchema } from "@api/lib/validate.js";

describe("runSubmitSchema (REQ-002)", () => {
  it("accepts a payload with hn only", () => {
    const result = runSubmitSchema.safeParse({
      topN: 10,
      hn: { sinceDays: 1 },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a payload with reddit only", () => {
    const result = runSubmitSchema.safeParse({
      topN: 10,
      reddit: { subreddits: ["LocalLLaMA"], sinceDays: 1 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects topN: 0", () => {
    const result = runSubmitSchema.safeParse({
      topN: 0,
      hn: { sinceDays: 1 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects topN: 51", () => {
    const result = runSubmitSchema.safeParse({
      topN: 51,
      hn: { sinceDays: 1 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects payload with no source group", () => {
    const result = runSubmitSchema.safeParse({ topN: 10 });
    expect(result.success).toBe(false);
  });

  it("rejects reddit with empty subreddits array", () => {
    const result = runSubmitSchema.safeParse({
      topN: 10,
      reddit: { subreddits: [], sinceDays: 1 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects sinceDays > 30", () => {
    const result = runSubmitSchema.safeParse({
      topN: 10,
      hn: { sinceDays: 31 },
    });
    expect(result.success).toBe(false);
  });
});
