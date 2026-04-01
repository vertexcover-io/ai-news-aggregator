import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type AppDb = ReturnType<typeof drizzle<typeof schema>>;

let db: AppDb | undefined;

function createClient(): AppDb {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  const sql = postgres(databaseUrl);
  return drizzle(sql, { schema });
}

export function getDb(): AppDb {
  if (!db) {
    db = createClient();
  }
  return db;
}
