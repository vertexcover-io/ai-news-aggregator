import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "@newsletter/shared/db";

let testDb: ReturnType<typeof drizzle<typeof schema>> | undefined;
let testSql: ReturnType<typeof postgres> | undefined;

export function getTestDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (!testDb) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL not set — load .env.test before calling getTestDb()");
    }
    testSql = postgres(databaseUrl);
    testDb = drizzle(testSql, { schema });
  }
  return testDb;
}

export async function truncateAll(): Promise<void> {
  const db = getTestDb();
  // RESTART IDENTITY resets auto-increment counters so IDs are predictable
  await db.execute(sql`TRUNCATE TABLE raw_items RESTART IDENTITY CASCADE`);
}

export async function closeTestDb(): Promise<void> {
  if (testSql) {
    await testSql.end();
    testSql = undefined;
    testDb = undefined;
  }
}
