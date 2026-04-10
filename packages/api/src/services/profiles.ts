import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, YAMLParseError } from "yaml";
import type { UserProfile } from "@newsletter/shared";
import { userProfileSchema } from "@api/lib/validate.js";

export class ProfileNotFoundError extends Error {
  constructor(name: string) {
    super(`profile not found: ${name}`);
    this.name = "ProfileNotFoundError";
  }
}

export class ProfileParseError extends Error {
  constructor(name: string, reason: string) {
    super(`profile ${name} invalid: ${reason}`);
    this.name = "ProfileParseError";
  }
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));
// packages/api/src/services/profiles.ts -> four levels up is the repo root.
// (services -> src -> api -> packages -> root)
const FALLBACK_PROFILES_DIR = path.resolve(currentDir, "../../../../profiles");

function resolveDefaultProfilesDir(): string {
  const fromEnv = process.env.PROFILES_DIR;
  if (fromEnv && fromEnv.trim().length > 0) {
    return path.resolve(fromEnv);
  }
  return FALLBACK_PROFILES_DIR;
}

export async function listProfiles(
  profilesDir: string = resolveDefaultProfilesDir(),
): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(profilesDir);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  return entries
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .map((f) => f.replace(/\.ya?ml$/, ""))
    .sort();
}

export async function loadProfile(
  name: string,
  profilesDir: string = resolveDefaultProfilesDir(),
): Promise<UserProfile> {
  const candidatePaths = [
    path.join(profilesDir, `${name}.yaml`),
    path.join(profilesDir, `${name}.yml`),
  ];
  let raw: string | null = null;
  for (const p of candidatePaths) {
    try {
      raw = await readFile(p, "utf8");
      break;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  if (raw === null) throw new ProfileNotFoundError(name);

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err: unknown) {
    if (err instanceof YAMLParseError) {
      throw new ProfileParseError(name, `yaml parse error: ${err.message}`);
    }
    throw err;
  }

  const result = userProfileSchema.safeParse(parsed);
  if (!result.success) {
    throw new ProfileParseError(name, result.error.message);
  }
  return { ...result.data, name };
}
