import { describe, expect, it } from "vitest";
import { jobIdFor } from "@shared/scheduling/job-ids.js";

describe("jobIdFor", () => {
  it("builds deterministic per-run job ids", () => {
    expect(jobIdFor("email-send", "abc-123")).toBe("email-send-abc-123");
    expect(jobIdFor("linkedin-post", "run-1")).toBe("linkedin-post-run-1");
  });
  it("never contains a colon (bullmq >=5.x rejects custom ids with ':')", () => {
    for (const channel of ["email-send", "linkedin-post", "twitter-post"] as const) {
      expect(jobIdFor(channel, "0c0ffee0-aaaa-bbbb-cccc-123456789012")).not.toContain(":");
    }
  });
});
