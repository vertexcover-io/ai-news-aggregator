import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { checkNoDockerReferences } from "../invariants/no-docker-references.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(__dirname, "fixtures");

describe("checkNoDockerReferences (REQ-084, EDGE-009)", () => {
  it("returns no violations when no docker references exist", () => {
    const result = checkNoDockerReferences({
      cwd: path.join(fixtures, "docker-good"),
    });
    expect(result.violations).toEqual([]);
  });

  it("flags files containing 'docker-compose'", () => {
    const result = checkNoDockerReferences({
      cwd: path.join(fixtures, "docker-bad"),
    });
    expect(result.violations.length).toBeGreaterThanOrEqual(1);
    expect(result.violations[0]?.invariant).toBe("no-docker-references");
    expect(result.violations[0]?.line).toBeGreaterThan(0);
  });

  it("skips lines marked with 'invariants:allow docker' (EDGE-009)", () => {
    const result = checkNoDockerReferences({
      cwd: path.join(fixtures, "docker-allowlist"),
    });
    expect(result.violations).toEqual([]);
  });
});
