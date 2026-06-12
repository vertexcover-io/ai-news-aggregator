import { config } from "dotenv";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

config({ path: resolve(import.meta.dirname, "../../../../.env") });

import { getDb } from "@newsletter/shared/db";
import { TENANT_ZERO_ID } from "@newsletter/shared/constants";
import { createEvalExportsRepo } from "@pipeline/repositories/eval-exports.js";
import { exportFixtures } from "@pipeline/eval/export-fixtures.js";

interface ParsedCliArgs {
  days: number;
  force: boolean;
  runId: string | undefined;
}

function parseCliArgs(argv: string[]): ParsedCliArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      days: { type: "string" },
      force: { type: "boolean", default: false },
      "run-id": { type: "string" },
    },
    strict: true,
  });

  const daysRaw = values.days;
  const days = daysRaw === undefined ? 15 : Number.parseInt(daysRaw, 10);
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error(`--days must be a positive integer, got: ${daysRaw}`);
  }

  return {
    days,
    force: values.force === true,
    runId: values["run-id"],
  };
}

async function main(): Promise<number> {
  const args = parseCliArgs(process.argv.slice(2));
  const db = getDb();
  // Offline operator CLI — runs against tenant 0's data (transitional, REQ-061).
  const repo = createEvalExportsRepo(db, TENANT_ZERO_ID);

  const result = await exportFixtures({
    days: args.days,
    force: args.force,
    runId: args.runId,
    repo,
  });

  console.log(
    `Exported ${result.exported}, skipped ${result.skipped}, failed ${result.failed}`,
  );
  for (const fixture of result.fixtures) {
    console.log(`  ${fixture.fixtureId} -> ${fixture.path}`);
  }

  if (result.failed > 0 && result.exported === 0) return 1;
  return 0;
}

process.exitCode = await main();
