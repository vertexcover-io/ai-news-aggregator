import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const scriptPath = path.join(repoRoot, "tools", "check-repo-invariants.ts");

describe("check-repo-invariants script (REQ-080)", () => {
  it("exits 0 with success message on the clean repo", () => {
    const output = execFileSync("pnpm", ["exec", "tsx", scriptPath], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(output).toContain("All repo invariants pass");
  });
});
