import { config } from "dotenv";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

config({ path: resolve(import.meta.dirname, "../../../../.env") });

import { getDb } from "@newsletter/shared/db";
import { createUserSettingsRepo } from "@pipeline/repositories/user-settings.js";
import { EvalCache } from "@pipeline/eval/cache.js";

import { BOOTSTRAP_TENANT_ID } from "@newsletter/shared/types/tenant-context";
const bootstrapCtx = { tenantId: BOOTSTRAP_TENANT_ID, role: "super_admin" as const };
import {
  runEvalCli,
  type RunEvalCliOptions,
} from "@pipeline/eval/run-eval-cli.js";

interface ParsedCliArgs {
  fixture: string | undefined;
  all: boolean;
  window: number | undefined;
  forceWindow: number | undefined;
  promptFile: string | undefined;
  noCache: boolean;
  dryRun: boolean;
  diff: boolean;
  json: boolean;
}

function parseCliArgs(argv: string[]): ParsedCliArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      fixture: { type: "string" },
      all: { type: "boolean", default: false },
      window: { type: "string" },
      "force-window": { type: "string" },
      "prompt-file": { type: "string" },
      "no-cache": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      diff: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
    strict: true,
  });

  const parseN = (raw: string | undefined, name: string): number | undefined => {
    if (raw === undefined) return undefined;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`--${name} must be a positive integer, got: ${raw}`);
    }
    return n;
  };

  return {
    fixture: values.fixture,
    all: values.all === true,
    window: parseN(values.window, "window"),
    forceWindow: parseN(values["force-window"], "force-window"),
    promptFile: values["prompt-file"],
    noCache: values["no-cache"] === true,
    dryRun: values["dry-run"] === true,
    diff: values.diff === true,
    json: values.json === true,
  };
}

async function main(): Promise<number> {
  const args = parseCliArgs(process.argv.slice(2));

  const loadPromptFromDb = async (): Promise<string> => {
    const db = getDb();
    const repo = createUserSettingsRepo(db, bootstrapCtx);
    const settings = await repo.get();
    if (settings === null) {
      throw new Error(
        "user_settings row not found — set rankingPrompt at /admin/settings or pass --prompt-file",
      );
    }
    return settings.rankingPrompt;
  };

  const cache = new EvalCache("evals/ranking/cache", {
    bypassCache: args.noCache,
  });

  const opts: RunEvalCliOptions = {
    fixture: args.fixture,
    all: args.all,
    window: args.window,
    forceWindow: args.forceWindow,
    promptFile: args.promptFile,
    noCache: args.noCache,
    dryRun: args.dryRun,
    diff: args.diff,
    json: args.json,
    cache,
    loadPromptFromDb,
  };

  const result = await runEvalCli(opts);
  return result.exitCode;
}

process.exitCode = await main();
