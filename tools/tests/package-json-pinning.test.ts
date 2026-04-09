import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { checkPackageJsonPinning } from "../invariants/package-json-pinning.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(__dirname, "fixtures");

describe("checkPackageJsonPinning (REQ-081, EDGE-007)", () => {
  it("returns no violations for exact-pinned package.json", () => {
    const result = checkPackageJsonPinning({
      cwd: path.join(fixtures, "pinning-good"),
    });
    expect(result.violations).toEqual([]);
  });

  it("flags caret and tilde ranges", () => {
    const result = checkPackageJsonPinning({
      cwd: path.join(fixtures, "pinning-bad"),
    });
    expect(result.violations.length).toBeGreaterThanOrEqual(2);
    const messages = result.violations.map((v) => v.message);
    expect(messages.some((m) => m.includes("lodash"))).toBe(true);
    expect(messages.some((m) => m.includes("zod"))).toBe(true);
    for (const v of result.violations) {
      expect(v.invariant).toBe("package-json-pinning");
    }
  });

  it("allows workspace:* and workspace:^ protocols (EDGE-007)", () => {
    const result = checkPackageJsonPinning({
      cwd: path.join(fixtures, "pinning-good"),
    });
    expect(result.violations).toEqual([]);
  });
});
