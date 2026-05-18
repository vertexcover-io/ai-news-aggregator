import { describe, expect, it } from "vitest";
import { jobIdFor } from "@shared/scheduling/job-ids.js";

describe("jobIdFor", () => {
  it("builds deterministic per-run job ids", () => {
    expect(jobIdFor("email-send", "abc-123")).toBe("email-send:abc-123");
    expect(jobIdFor("linkedin-post", "run-1")).toBe("linkedin-post:run-1");
  });
});
