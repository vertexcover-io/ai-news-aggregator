import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { checkAiSdkAlignment } from "../invariants/ai-sdk-alignment.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(__dirname, "fixtures");

describe("checkAiSdkAlignment (REQ-082, EDGE-008)", () => {
  it("returns no violations when @ai-sdk/* providers share a major", () => {
    const result = checkAiSdkAlignment({
      cwd: path.join(fixtures, "ai-good"),
    });
    expect(result.violations).toEqual([]);
  });

  it("flags major-version drift among @ai-sdk/* providers", () => {
    const result = checkAiSdkAlignment({
      cwd: path.join(fixtures, "ai-bad"),
    });
    expect(result.violations.length).toBeGreaterThanOrEqual(1);
    expect(result.violations[0]?.invariant).toBe("ai-sdk-alignment");
    expect(result.violations[0]?.message).toMatch(/major/i);
  });

  it("does not flag when ai is present but no @ai-sdk/* deps exist (EDGE-008)", () => {
    const result = checkAiSdkAlignment({
      cwd: path.join(fixtures, "ai-only-core"),
    });
    expect(result.violations).toEqual([]);
  });
});
