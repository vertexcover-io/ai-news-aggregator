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

interface CollectedVersion {
  name: string;
  version: string;
  major: number;
  file: string;
}

function parseMajor(version: string): number | null {
  const stripped = version.replace(/^[\^~]/, "");
  const match = /^(\d+)\./.exec(stripped);
  if (match?.[1] === undefined) return null;
  return Number.parseInt(match[1], 10);
}

export function checkAiSdkAlignment(
  context: InvariantContext,
): InvariantResult {
  const violations: Violation[] = [];
  const files = findPackageJsonFiles(context.cwd);

  const aiVersions: CollectedVersion[] = [];
  const providerVersions: CollectedVersion[] = [];

  for (const file of files) {
    const raw = fs.readFileSync(file, "utf8");
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
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
        const major = parseMajor(version);
        if (major === null) continue;
        const rel = path.relative(context.cwd, file) || file;
        if (name === "ai") {
          aiVersions.push({ name, version, major, file: rel });
        } else if (name.startsWith("@ai-sdk/")) {
          providerVersions.push({ name, version, major, file: rel });
        }
      }
    }
  }

  if (providerVersions.length === 0) {
    return { violations };
  }

  // The Vercel AI SDK ships `ai` (core) and `@ai-sdk/*` (providers) on independent
  // major-version lines (currently ai@5.x ↔ @ai-sdk/*@2.x). Cross-major equality
  // between core and providers is therefore not a meaningful invariant. We instead
  // enforce that all `@ai-sdk/*` providers move together (same major), which is
  // the real drift pattern we want to catch.
  const providersByMajor = new Map<number, CollectedVersion[]>();
  for (const provider of providerVersions) {
    const bucket = providersByMajor.get(provider.major) ?? [];
    bucket.push(provider);
    providersByMajor.set(provider.major, bucket);
  }
  if (providersByMajor.size > 1) {
    const summary = [...providersByMajor.entries()]
      .map(
        ([major, items]) =>
          `major ${major}: ${items.map((i) => `${i.name}@${i.version}`).join(", ")}`,
      )
      .join("; ");
    for (const provider of providerVersions) {
      violations.push({
        invariant: "ai-sdk-alignment",
        file: provider.file,
        message: `@ai-sdk/* providers must share a major version. Found ${summary}`,
      });
    }
  }

  if (aiVersions.length > 1) {
    const majors = new Set(aiVersions.map((v) => v.major));
    if (majors.size > 1) {
      for (const v of aiVersions) {
        violations.push({
          invariant: "ai-sdk-alignment",
          file: v.file,
          message: `ai@${v.version} disagrees with other ai majors in the workspace: ${[...majors].join(", ")}`,
        });
      }
    }
  }

  return { violations };
}
