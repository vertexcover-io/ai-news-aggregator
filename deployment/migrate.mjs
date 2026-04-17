// Runs Drizzle migrations against the production DB.
// Copied into /app/migrate.mjs by deployment/dockerfiles/api.Dockerfile.
// Reads DATABASE_URL from the environment (compose sets it from /etc/newsletter/.env).

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
	console.error("DATABASE_URL is not set");
	process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
	await migrate(drizzle(sql), { migrationsFolder: "/app/migrations" });
	console.log("migrations ok");
} finally {
	await sql.end();
}
