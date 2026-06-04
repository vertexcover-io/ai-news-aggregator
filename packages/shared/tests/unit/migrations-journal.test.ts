import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

const migrationsDir = join(__dirname, "../../src/db/migrations");
const journal = JSON.parse(
  readFileSync(join(migrationsDir, "meta/_journal.json"), "utf8"),
) as { entries: JournalEntry[] };

// Regression guard for the 0035_record_review_edits incident: a hand-edited,
// backdated `when` made drizzle-kit (which applies only entries with
// `when > last applied timestamp`) silently skip the migration on every
// database that had already migrated past its neighbours. Fresh databases
// were unaffected, so CI never caught it — only this invariant check can.
describe("migrations journal integrity", () => {
  it("has strictly increasing `when` timestamps", () => {
    for (let i = 1; i < journal.entries.length; i++) {
      const prev = journal.entries[i - 1];
      const curr = journal.entries[i];
      expect(
        curr.when,
        `entry ${String(curr.idx)} (${curr.tag}) has when=${String(curr.when)} ` +
          `which is not after entry ${String(prev.idx)} (${prev.tag}, when=${String(prev.when)}). ` +
          `Out-of-order timestamps make drizzle-kit silently skip the migration ` +
          `on already-migrated databases.`,
      ).toBeGreaterThan(prev.when);
    }
  });

  it("has contiguous idx values starting at 0", () => {
    journal.entries.forEach((entry, i) => {
      expect(entry.idx).toBe(i);
    });
  });

  it("has a SQL file for every journal entry and vice versa", () => {
    const sqlFiles = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.replace(/\.sql$/, ""))
      .sort();
    const tags = journal.entries.map((e) => e.tag).sort();
    expect(sqlFiles).toEqual(tags);
  });
});
