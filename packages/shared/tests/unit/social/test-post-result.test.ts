import { describe, it, expect } from "vitest";
import { socialTestKey, SOCIAL_TEST_TTL_SECONDS } from "@newsletter/shared";

describe("socialTestKey", () => {
  it("formats key as 'social-test:<requestId>'", () => {
    expect(socialTestKey("abc-123")).toBe("social-test:abc-123");
    expect(SOCIAL_TEST_TTL_SECONDS).toBe(300);
  });
});
