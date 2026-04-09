import fs from "node:fs";
import path from "node:path";
import type { InvariantContext, InvariantResult, Violation } from "./types.js";

interface TsconfigShape {
  exclude?: unknown;
}

function stripJsonComments(input: string): string {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

export function checkVitestConfigExcluded(
  context: InvariantContext,
): InvariantResult {
  const violations: Violation[] = [];
  const packagesDir = path.join(context.cwd, "packages");
  if (!fs.existsSync(packagesDir)) return { violations };

  const entries = fs.readdirSync(packagesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkgDir = path.join(packagesDir, entry.name);
    const vitestConfig = path.join(pkgDir, "vitest.config.ts");
    if (!fs.existsSync(vitestConfig)) continue;

    const tsconfigPath = path.join(pkgDir, "tsconfig.json");
    if (!fs.existsSync(tsconfigPath)) {
      violations.push({
        invariant: "vitest-config-excluded",
        file: path.relative(context.cwd, pkgDir) || pkgDir,
        message: `vitest.config.ts exists but tsconfig.json is missing`,
      });
      continue;
    }

    const raw = fs.readFileSync(tsconfigPath, "utf8");
    let parsed: TsconfigShape;
    try {
      parsed = JSON.parse(stripJsonComments(raw)) as TsconfigShape;
    } catch {
      violations.push({
        invariant: "vitest-config-excluded",
        file: path.relative(context.cwd, tsconfigPath) || tsconfigPath,
        message: `tsconfig.json is not valid JSON`,
      });
      continue;
    }

    const exclude = Array.isArray(parsed.exclude) ? parsed.exclude : [];
    if (!exclude.includes("vitest.config.ts")) {
      violations.push({
        invariant: "vitest-config-excluded",
        file: path.relative(context.cwd, tsconfigPath) || tsconfigPath,
        message: `tsconfig.json must include "vitest.config.ts" in its exclude array`,
      });
    }
  }

  return { violations };
}
