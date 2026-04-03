import { config } from "dotenv";
import { resolve } from "node:path";
import postgres from "postgres";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";

export async function setup(): Promise<void> {
  config({ path: resolve(import.meta.dirname, "../../../../../.env.test") });

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL not set in .env.test");
  }

  // Connect to the 'postgres' maintenance DB to create the test DB
  const maintenanceUrl = databaseUrl.replace(/\/[^/]+$/, "/postgres");
  const maintenanceSql = postgres(maintenanceUrl);

  const result = await maintenanceSql`
    SELECT 1 FROM pg_database WHERE datname = 'newsletter_test'
  `;

  if (result.length === 0) {
    await maintenanceSql`CREATE DATABASE newsletter_test`;
    console.log("Created newsletter_test database");
  }

  await maintenanceSql.end();

  // Run Drizzle migrations against the test DB
  const migrationSql = postgres(databaseUrl);
  const db = drizzle(migrationSql);

  await migrate(db, {
    migrationsFolder: resolve(import.meta.dirname, "../../../../../packages/shared/src/db/migrations"),
  });

  console.log("Migrations applied to newsletter_test");
  await migrationSql.end();
}

export async function teardown(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;

  const teardownSql = postgres(databaseUrl);
  await teardownSql`TRUNCATE TABLE raw_items, sources RESTART IDENTITY CASCADE`;
  await teardownSql.end();
}
