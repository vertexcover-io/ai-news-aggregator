import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadProfile, listProfiles } from "@api/services/profiles.js";

const REPO_PROFILES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../..",
  "profiles",
);

describe("real profile fixtures at repo root", () => {
  it("lists aman and ritesh", async () => {
    const names = await listProfiles(REPO_PROFILES_DIR);
    expect(names).toContain("aman");
    expect(names).toContain("ritesh");
  });

  it("loadProfile('aman') parses and returns the expected shape", async () => {
    const profile = await loadProfile("aman", REPO_PROFILES_DIR);
    expect(profile.name).toBe("aman");
    expect(Array.isArray(profile.topics)).toBe(true);
    expect(profile.topics.length).toBeGreaterThan(0);
    expect(profile.topics.every((t) => typeof t === "string")).toBe(true);
    expect(Array.isArray(profile.antiTopics)).toBe(true);
    expect(profile.antiTopics?.every((t) => typeof t === "string")).toBe(true);
  });

  it("loadProfile('ritesh') parses and returns the expected shape", async () => {
    const profile = await loadProfile("ritesh", REPO_PROFILES_DIR);
    expect(profile.name).toBe("ritesh");
    expect(Array.isArray(profile.topics)).toBe(true);
    expect(profile.topics.length).toBeGreaterThan(0);
    expect(profile.topics.every((t) => typeof t === "string")).toBe(true);
    expect(Array.isArray(profile.antiTopics)).toBe(true);
    expect(profile.antiTopics?.every((t) => typeof t === "string")).toBe(true);
  });
});
