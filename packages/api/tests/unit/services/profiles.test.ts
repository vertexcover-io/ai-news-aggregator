import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  listProfiles,
  loadProfile,
  ProfileNotFoundError,
  ProfileParseError,
} from "@api/services/profiles.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "profiles-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("listProfiles", () => {
  it("returns .yaml file stems sorted alphabetically", async () => {
    await writeFile(path.join(dir, "zeta.yaml"), "name: zeta\ntopics: [a]\n");
    await writeFile(path.join(dir, "alpha.yaml"), "name: alpha\ntopics: [a]\n");
    await writeFile(path.join(dir, "readme.txt"), "ignored");
    const result = await listProfiles(dir);
    expect(result).toEqual(["alpha", "zeta"]);
  });

  it("EDGE-017: returns [] for an empty directory", async () => {
    const result = await listProfiles(dir);
    expect(result).toEqual([]);
  });

  it("returns [] if the directory does not exist", async () => {
    const ghost = path.join(dir, "nope");
    const result = await listProfiles(ghost);
    expect(result).toEqual([]);
  });
});

describe("loadProfile", () => {
  it("parses and returns a UserProfile matching the zod schema", async () => {
    await writeFile(
      path.join(dir, "valid.yaml"),
      "name: valid\ntopics:\n  - llm\n  - agents\nantiTopics:\n  - crypto\n",
    );
    const profile = await loadProfile("valid", dir);
    expect(profile).toEqual({
      name: "valid",
      topics: ["llm", "agents"],
      antiTopics: ["crypto"],
    });
  });

  it("enforces profile.name === filename stem (defensive override)", async () => {
    await writeFile(
      path.join(dir, "valid.yaml"),
      "name: mismatch\ntopics:\n  - llm\n",
    );
    const profile = await loadProfile("valid", dir);
    expect(profile.name).toBe("valid");
  });

  it("throws ProfileNotFoundError with name in message when file missing", async () => {
    await expect(loadProfile("missing", dir)).rejects.toSatisfy((err) => {
      return (
        err instanceof ProfileNotFoundError &&
        (err as Error).message.includes("missing")
      );
    });
  });

  it("EDGE-009: throws ProfileParseError with name in message and no absolute path leaked", async () => {
    await writeFile(
      path.join(dir, "malformed.yaml"),
      "name: malformed\ntopics:\n  - unclosed\n   bad: [indent\n",
    );
    await expect(loadProfile("malformed", dir)).rejects.toSatisfy((err) => {
      if (!(err instanceof ProfileParseError)) return false;
      const msg = (err as Error).message;
      return msg.includes("malformed") && !msg.includes(dir);
    });
  });

  it("throws ProfileParseError with zod error when required field missing", async () => {
    await writeFile(
      path.join(dir, "bad-schema.yaml"),
      "name: bad-schema\n",
    );
    await expect(loadProfile("bad-schema", dir)).rejects.toBeInstanceOf(
      ProfileParseError,
    );
  });

  it("supports .yml extension as a fallback", async () => {
    await mkdir(path.join(dir, "sub"), { recursive: true });
    await writeFile(
      path.join(dir, "sub", "prof.yml"),
      "name: prof\ntopics:\n  - x\n",
    );
    const profile = await loadProfile("prof", path.join(dir, "sub"));
    expect(profile.name).toBe("prof");
  });
});

describe("PROFILES_DIR env var precedence", () => {
  const originalEnv = process.env.PROFILES_DIR;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.PROFILES_DIR;
    } else {
      process.env.PROFILES_DIR = originalEnv;
    }
  });

  it("uses PROFILES_DIR from env when no explicit argument is passed", async () => {
    await writeFile(
      path.join(dir, "envprof.yaml"),
      "name: envprof\ntopics:\n  - x\n",
    );
    process.env.PROFILES_DIR = dir;

    const names = await listProfiles();
    expect(names).toContain("envprof");

    const profile = await loadProfile("envprof");
    expect(profile.name).toBe("envprof");
  });
});
