import fs from "node:fs";
import path from "node:path";
import type { InvariantContext, InvariantResult, Violation } from "./types.js";
import { walkDir } from "./fs-utils.js";

const SCAN_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".yml",
  ".yaml",
]);

const SCAN_ROOTS = ["packages", "tools", "docs"];
const ALLOWLIST_MARKER = "invariants:allow docker";
const DOCKER_COMPOSE = "docker" + "-compose";
const DOCKER_SPACE = "docker" + " ";

function shouldSkipFile(file: string, cwd: string): boolean {
  const base = path.basename(file);
  if (base.endsWith(".test.ts") || base.endsWith(".test.tsx")) return true;
  const toolsFixtures = path.join(cwd, "tools", "tests", "fixtures") + path.sep;
  if (file.startsWith(toolsFixtures)) return true;
  return false;
}

function scanFile(
  file: string,
  cwd: string,
  violations: Violation[],
): void {
  let content: string;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (line.includes(ALLOWLIST_MARKER)) continue;
    const hasCompose = line.includes(DOCKER_COMPOSE);
    const hasDockerSpace = line.includes(DOCKER_SPACE);
    if (!hasCompose && !hasDockerSpace) continue;
    const matched = hasCompose ? DOCKER_COMPOSE : DOCKER_SPACE.trim();
    violations.push({
      invariant: "no-docker-references",
      file: path.relative(cwd, file) || file,
      line: index + 1,
      message: `contains forbidden reference "${matched}" (use podman / podman-compose instead, or add a line-level "${ALLOWLIST_MARKER}" marker)`,
    });
  }
}

export function checkNoDockerReferences(
  context: InvariantContext,
): InvariantResult {
  const violations: Violation[] = [];

  for (const rootName of SCAN_ROOTS) {
    const root = path.join(context.cwd, rootName);
    const files = walkDir(root, (f) => {
      if (shouldSkipFile(f, context.cwd)) return false;
      return SCAN_EXTENSIONS.has(path.extname(f));
    });
    for (const file of files) {
      scanFile(file, context.cwd, violations);
    }
  }

  return { violations };
}
