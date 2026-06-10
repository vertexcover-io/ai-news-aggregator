/**
 * Phase 8 migration: Lift AGENTLOOP's JSONB source config from user_settings
 * into normalized sources rows.
 *
 * Run AFTER 0042_lowly_flatman.sql has created the sources table.
 *
 * Usage: Run from the shared package:
 *   cd packages/shared && npx tsx src/db/migrate-sources-lift.ts
 */

// dotenv not available here; DATABASE_URL is expected from env
import { getDb } from "./client.js";
import { userSettings, sources } from "./schema.js";

const db = getDb();

async function main() {
  const allSettings = await db
    .select()
    .from(userSettings)
    .limit(1);

  let totalCreated = 0;
  const now = new Date();

  for (const row of allSettings) {
    const tid = row.tenantId;
    if (!tid) continue;

    const entries: {
      type: string;
      config: Record<string, unknown> | null;
      enabled: boolean;
    }[] = [
      {
        type: "hn",
        config: row.hnConfig as Record<string, unknown> | null,
        enabled: row.hnEnabled,
      },
      {
        type: "reddit",
        config: row.redditConfig as Record<string, unknown> | null,
        enabled: row.redditEnabled,
      },
      {
        type: "blog",
        config: row.webConfig as Record<string, unknown> | null,
        enabled: row.webEnabled,
      },
      {
        type: "twitter",
        config: row.twitterConfig as Record<string, unknown> | null,
        enabled: row.twitterEnabled,
      },
      {
        type: "web_search",
        config: row.webSearchConfig as Record<string, unknown> | null,
        enabled: row.webSearchEnabled,
      },
    ];

    for (const entry of entries) {
      if (!entry.enabled && entry.config === null) continue;

      try {
        await db.insert(sources).values({
          tenantId: tid,
          type: entry.type as typeof sources.$inferInsert["type"],
          config: entry.config,
          enabled: entry.enabled,
          createdAt: now,
          updatedAt: now,
        });
        totalCreated++;
        console.log(`  created source: tenant=${tid.substring(0, 8)}... type=${entry.type} enabled=${String(entry.enabled)}`);
      } catch (err: unknown) {
        console.error(`  FAILED creating source for tenant=${tid.substring(0, 8)}... type=${entry.type}:`, err);
      }
    }
  }

  console.log(`\nMigration complete: ${String(totalCreated)} sources created from ${String(allSettings.length)} user_settings rows.`);
}

main()
  .then(() => {
    console.log("Done.");
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
