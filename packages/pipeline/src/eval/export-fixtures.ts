import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { randomUUID } from "node:crypto";

import { FIXTURES_DIR } from "@newsletter/shared/constants/eval-ranking";
import type {
  Fixture,
  FixtureItem,
  OriginalRankerOutputEntry,
} from "@newsletter/shared/types/eval-ranking";
import { FixtureSchema } from "@newsletter/shared/types/eval-ranking-schemas";

import type {
  EvalExportArchiveRow,
  EvalExportsRepo,
} from "@pipeline/repositories/eval-exports.js";
import type { RawItemRow } from "@pipeline/repositories/raw-items.js";

const DEFAULT_DAYS = 15;
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export interface ExportOptions {
  days?: number;
  force?: boolean;
  runId?: string;
  repo: EvalExportsRepo;
  fixturesDir?: string;
  now?: Date;
}

export interface ExportedFixture {
  runId: string;
  fixtureId: string;
  path: string;
}

export interface ExportResult {
  exported: number;
  skipped: number;
  failed: number;
  fixtures: ExportedFixture[];
}

function formatDate(date: Date): string {
  const yyyy = date.getUTCFullYear().toString().padStart(4, "0");
  const mm = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = date.getUTCDate().toString().padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function buildFixtureId(archive: EvalExportArchiveRow): string {
  const datePart = formatDate(archive.createdAt);
  const shortId = archive.id.replace(/-/g, "").slice(0, 8);
  return `run-${datePart}-${shortId}`;
}

function buildFixtureItem(row: RawItemRow): FixtureItem {
  const enrichedLink = row.metadata.enrichedLink ?? null;
  const enrichmentStatus = enrichedLink?.status ?? "skipped";
  const comments = row.metadata.comments;
  return {
    rawItemId: row.id,
    title: row.title,
    url: row.url,
    sourceType: row.sourceType,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    content: row.content,
    enrichedLink,
    enrichmentStatus,
    comments,
    engagement: row.engagement,
  };
}

function buildOriginalRankerOutput(
  archive: EvalExportArchiveRow,
): OriginalRankerOutputEntry[] {
  return archive.rankedItems.map((ref, index) => ({
    rawItemId: ref.rawItemId,
    score: index + 1,
    rationale: ref.rationale,
  }));
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

async function writeFixtureAtomic(
  targetPath: string,
  fixture: Fixture,
): Promise<void> {
  const tmpPath = `${targetPath}.${randomUUID()}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  await rename(tmpPath, targetPath);
}

export async function exportFixtures(opts: ExportOptions): Promise<ExportResult> {
  const days = opts.days ?? DEFAULT_DAYS;
  const force = opts.force ?? false;
  const now = opts.now ?? new Date();
  const fixturesDir = resolvePath(opts.fixturesDir ?? FIXTURES_DIR);
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const model = process.env.RANKING_MODEL ?? DEFAULT_MODEL;

  await mkdir(fixturesDir, { recursive: true });

  const archives = await opts.repo.listCompletedArchives({
    since,
    runId: opts.runId,
  });

  const result: ExportResult = {
    exported: 0,
    skipped: 0,
    failed: 0,
    fixtures: [],
  };

  for (const archive of archives) {
    const fixtureId = buildFixtureId(archive);
    const targetPath = resolvePath(fixturesDir, `${fixtureId}.json`);

    if (!force && (await fileExists(targetPath))) {
      result.skipped += 1;
      result.fixtures.push({ runId: archive.id, fixtureId, path: targetPath });
      continue;
    }

    try {
      const windowFrom = archive.startedAt ?? archive.createdAt;
      const windowTo = archive.completedAt;
      const rows = await opts.repo.findRawItemsInWindow({
        from: windowFrom,
        to: windowTo,
      });

      const pool = rows.map(buildFixtureItem);

      const fixture: Fixture = {
        fixtureId,
        source: "run",
        date: formatDate(archive.createdAt),
        runId: archive.id,
        model,
        exportedAt: now.toISOString(),
        pool,
        // TODO: derive dedup clusters from raw_items.metadata once dedup
        // persists clusters back to the row; for now we always emit an empty
        // array. Scoring functions tolerate empty clusters.
        dedupClusters: [],
        originalRankerOutput: buildOriginalRankerOutput(archive),
      };

      FixtureSchema.parse(fixture);
      await writeFixtureAtomic(targetPath, fixture);

      result.exported += 1;
      result.fixtures.push({ runId: archive.id, fixtureId, path: targetPath });
    } catch (err) {
      result.failed += 1;
      console.error(
        `export-fixtures: failed runId=${archive.id} fixtureId=${fixtureId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return result;
}
