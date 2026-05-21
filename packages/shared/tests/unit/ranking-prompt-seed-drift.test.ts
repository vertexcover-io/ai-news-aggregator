import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_RANKING_PROMPT } from "@shared/constants/ranking-prompt.js";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "src", "db", "migrations");

function locateSeedMigration(): string {
  const matches = readdirSync(MIGRATIONS_DIR).filter((f) => /^0026_.*\.sql$/.test(f));
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one 0026_*.sql migration, found ${matches.length}: ${matches.join(", ")}`,
    );
  }
  return join(MIGRATIONS_DIR, matches[0]);
}

function extractDollarQuotedSeed(sql: string): string {
  const open = sql.indexOf("$prompt$");
  const close = sql.indexOf("$prompt$", open + 1);
  if (open === -1 || close === -1) {
    throw new Error("Could not find dollar-quoted $prompt$...$prompt$ block in migration");
  }
  return sql.slice(open + "$prompt$".length, close);
}

describe("0026 ranking_prompt seed", () => {
  it("DEFAULT_RANKING_PROMPT is non-empty multi-line text", () => {
    expect(DEFAULT_RANKING_PROMPT.trim().length).toBeGreaterThan(0);
    expect(DEFAULT_RANKING_PROMPT).toContain("\n");
  });

  it("seed SQL embeds DEFAULT_RANKING_PROMPT byte-for-byte", () => {
    const sql = readFileSync(locateSeedMigration(), "utf8");
    const seed = extractDollarQuotedSeed(sql);
    expect(seed).toEqual(DEFAULT_RANKING_PROMPT);
  });

  it("migration follows 3-step pattern: ADD nullable, UPDATE, SET NOT NULL", () => {
    const sql = readFileSync(locateSeedMigration(), "utf8");
    expect(sql).toMatch(/ALTER TABLE "user_settings" ADD COLUMN "ranking_prompt" text;/);
    expect(sql).toMatch(/UPDATE "user_settings" SET "ranking_prompt" = \$prompt\$/);
    expect(sql).toMatch(
      /ALTER TABLE "user_settings" ALTER COLUMN "ranking_prompt" SET NOT NULL;/,
    );
  });
});
