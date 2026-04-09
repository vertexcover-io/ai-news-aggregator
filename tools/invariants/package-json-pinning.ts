import fs from "node:fs";
import path from "node:path";
import type { InvariantContext, InvariantResult, Violation } from "./types.js";
import { findPackageJsonFiles } from "./fs-utils.js";

const DEPENDENCY_KEYS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

type PackageJsonShape = Record<string, unknown>;

function isPinned(version: string): boolean {
  if (version.startsWith("workspace:")) return true;
  if (version.startsWith("^") || version.startsWith("~")) return false;
  return true;
}

export function checkPackageJsonPinning(
  context: InvariantContext,
): InvariantResult {
  const violations: Violation[] = [];
  const files = findPackageJsonFiles(context.cwd);

  for (const file of files) {
    const raw = fs.readFileSync(file, "utf8");
    let parsed: PackageJsonShape;
    try {
      parsed = JSON.parse(raw) as PackageJsonShape;
    } catch {
      continue;
    }

    for (const depKey of DEPENDENCY_KEYS) {
      const section = parsed[depKey];
      if (!section || typeof section !== "object") continue;
      for (const [name, version] of Object.entries(
        section as Record<string, unknown>,
      )) {
        if (typeof version !== "string") continue;
        if (!isPinned(version)) {
          violations.push({
            invariant: "package-json-pinning",
            file: path.relative(context.cwd, file) || file,
            message: `${depKey}.${name} = "${version}" — use exact pin (no ^ or ~)`,
          });
        }
      }
    }
  }

  return { violations };
}
