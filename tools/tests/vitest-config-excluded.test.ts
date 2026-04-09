import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { checkVitestConfigExcluded } from "../invariants/vitest-config-excluded.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(__dirname, "fixtures");

describe("checkVitestConfigExcluded (REQ-083, EDGE-011)", () => {
  it("returns no violations when vitest.config.ts is in tsconfig exclude", () => {
    const result = checkVitestConfigExcluded({
      cwd: path.join(fixtures, "vitest-good"),
    });
    expect(result.violations).toEqual([]);
  });

  it("flags packages where vitest.config.ts is missing from tsconfig exclude", () => {
    const result = checkVitestConfigExcluded({
      cwd: path.join(fixtures, "vitest-bad"),
    });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.invariant).toBe("vitest-config-excluded");
    expect(result.violations[0]?.message).toContain("vitest.config.ts");
  });

  it("does not flag packages without vitest.config.ts (EDGE-011)", () => {
    const result = checkVitestConfigExcluded({
      cwd: path.join(fixtures, "vitest-no-config"),
    });
    expect(result.violations).toEqual([]);
  });
});
