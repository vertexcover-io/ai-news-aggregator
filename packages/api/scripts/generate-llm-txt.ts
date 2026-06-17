// Materializes the llm.txt site files into the tracked `llms/` directory at the
// repo root. Uses the SAME @newsletter/shared/llm-txt generator the live API
// endpoints use, so committed files never drift from served responses.
//
//   pnpm --filter @newsletter/api generate:llm-txt
//
// Writes:
//   llms/llms.txt                        site index
//   llms/llms-full.txt                   full-content index
//   llms/canon.llm.txt                   the must-read canon
//   llms/issues/<date>-<runId>.llm.txt   one per published issue
import { config } from "dotenv";
config({ path: "../../.env" });

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import {
  getDb,
  formatDateInTimezone,
  safeTimezone,
} from "@newsletter/shared";
import { resolveBaseUrls } from "@api/lib/base-urls.js";
import { createRunArchivesRepo } from "@api/repositories/run-archives.js";
import { createRawItemsRepo } from "@api/repositories/raw-items.js";
import { createMustReadRepo, toPublicWire } from "@api/repositories/must-read.js";
import { createUserSettingsRepo } from "@api/repositories/user-settings.js";
import { hydrateRankedItems } from "@api/services/rank-hydration.js";
import {
  buildLlmTxtSnapshot,
  type LlmTxtSnapshotData,
} from "@api/services/llm-txt-snapshot.js";

const ISSUE_LIMIT = 30;
const OUT_DIR = resolve(process.cwd(), "../../llms");

async function loadData(baseUrl: string): Promise<LlmTxtSnapshotData> {
  const db = getDb();
  const archiveRepo = createRunArchivesRepo(db);
  const rawItemsRepo = createRawItemsRepo(db);
  const mustReadRepo = createMustReadRepo(db);
  const settingsRepo = createUserSettingsRepo(db);

  const settings = await settingsRepo.get();
  const timezone = safeTimezone(settings?.scheduleTimezone);

  const rows = await archiveRepo.listReviewedRows(ISSUE_LIMIT);

  const issues = await Promise.all(
    rows.map(async (row) => {
      const issueDate = formatDateInTimezone(
        row.publishedAt ?? row.startedAt ?? row.completedAt,
        timezone,
      );
      const hydrated = await hydrateRankedItems(
        rawItemsRepo,
        row.rankedItems,
        row.completedAt,
      );
      return {
        meta: {
          runId: row.id,
          issueDate,
          digestHeadline: row.digestHeadline,
          digestSummary: row.digestSummary,
        },
        stories: hydrated.map((i) => ({ title: i.title, url: i.url, recap: i.recap })),
      };
    }),
  );

  const canon = (await mustReadRepo.listPublic()).map(toPublicWire);
  return { baseUrl, issues, canon };
}

async function main(): Promise<void> {
  const baseUrl = resolveBaseUrls(process.env).webBaseUrl;
  const data = await loadData(baseUrl);
  const snapshot = buildLlmTxtSnapshot(data);

  mkdirSync(OUT_DIR, { recursive: true });
  rmSync(resolve(OUT_DIR, "issues"), { recursive: true, force: true });
  mkdirSync(resolve(OUT_DIR, "issues"), { recursive: true });

  writeFileSync(resolve(OUT_DIR, "llms.txt"), snapshot.index, "utf8");
  writeFileSync(resolve(OUT_DIR, "llms-full.txt"), snapshot.indexFull, "utf8");
  writeFileSync(resolve(OUT_DIR, "canon.llm.txt"), snapshot.canon, "utf8");
  for (const file of snapshot.issueFiles) {
    writeFileSync(resolve(OUT_DIR, "issues", file.fileName), file.content, "utf8");
  }

  // eslint-disable-next-line no-console
  console.log(
    `Wrote ${snapshot.issueFiles.length} issue file(s) + index to ${OUT_DIR}`,
  );
  process.exit(0);
}

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
