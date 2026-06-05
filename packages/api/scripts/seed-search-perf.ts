// One-shot perf bench for VS-10 (REQ-028: P95 ≤ 200ms at 1k archives).
//
// Seeds 1,000 synthetic reviewed archives (each referencing 5–10 raw_items),
// then runs 100 sequential GET /api/archives/search?q=<random-token> calls
// and writes a JSON report. Synthetic rows are tagged with the marker
// `[SYNTHETIC-PERF-SEED]` in `digest_summary` so a teardown query can wipe
// them. Run with `--teardown` to clean up without seeding/benchmarking.
import { config } from "dotenv";
config({ path: "../../.env" });

import { performance } from "node:perf_hooks";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import {
  serializeArchiveSearchText,
  type ArchiveSearchInput,
  type ArchiveSearchRawItem,
} from "@newsletter/shared";
import type { RankedItemRef, RawItemMetadata } from "@newsletter/shared";
import type { SourceType } from "@newsletter/shared";

const SYNTHETIC_MARKER = "[SYNTHETIC-PERF-SEED]";
const N_ARCHIVES = 1000;
const N_QUERIES = 100;
const ITEMS_PER_ARCHIVE_MIN = 5;
const ITEMS_PER_ARCHIVE_MAX = 10;
const P95_THRESHOLD_MS = 200;
const API_BASE = process.env.API_BASE_URL ?? "http://localhost:3000";
const REPORT_PATH = resolve(
  process.cwd(),
  "../../.harness/features/add-archive-keyword-search/verification/perf-report.json",
);

const TEST_TOKENS = [
  "agentic",
  "claude",
  "qwen",
  "context",
  "inference",
  "embedding",
];

const FILLER_POOL = [
  "model",
  "training",
  "release",
  "research",
  "paper",
  "framework",
  "benchmark",
  "feature",
  "update",
  "platform",
  "engineering",
  "system",
  "evaluation",
  "tooling",
  "deployment",
  "open-source",
];

const SOURCE_TYPES: SourceType[] = [
  "hn",
  "reddit",
  "twitter",
  "rss",
  "github",
  "blog",
];

interface CliArgs {
  teardown: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  return { teardown: argv.includes("--teardown") };
}

function pick<T>(arr: readonly T[], rand: () => number): T {
  return arr[Math.floor(rand() * arr.length)];
}

function randomInt(min: number, max: number, rand: () => number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function buildText(rand: () => number, tokenCount: number): string {
  const words: string[] = [];
  for (let i = 0; i < tokenCount; i++) {
    if (rand() < 0.25) {
      words.push(pick(TEST_TOKENS, rand));
    } else {
      words.push(pick(FILLER_POOL, rand));
    }
  }
  return words.join(" ");
}

interface SeededRawItem {
  id: number;
}

async function seed(sql: postgres.Sql): Promise<void> {
  const rand = makeRng(42);
  console.log(
    `[seed] inserting ${N_ARCHIVES} synthetic reviewed archives ...`,
  );

  // Make sure prior synthetic data is cleared first.
  await teardown(sql, /* silent */ true);

  const startedAt = Date.now();

  for (let i = 0; i < N_ARCHIVES; i++) {
    const itemCount = randomInt(
      ITEMS_PER_ARCHIVE_MIN,
      ITEMS_PER_ARCHIVE_MAX,
      rand,
    );

    const inserted: SeededRawItem[] = [];
    const rawItemsById = new Map<number, ArchiveSearchRawItem>();
    const rankedItems: RankedItemRef[] = [];

    for (let j = 0; j < itemCount; j++) {
      const sourceType = pick(SOURCE_TYPES, rand);
      const externalId = `synthetic-${randomUUID()}`;
      const title = `${buildText(rand, 4)} (${SYNTHETIC_MARKER})`;
      const url = `https://example.com/${externalId}`;
      const author = pick(["alice", "bob", "carol", "dan", "eve"], rand);
      const summary = buildText(rand, 30);
      const bullets = [
        buildText(rand, 12),
        buildText(rand, 12),
        buildText(rand, 12),
      ];
      const bottomLine = buildText(rand, 18);

      const metadata: RawItemMetadata = {
        comments: [],
        recap: { summary, bullets, bottomLine },
      };

      const [row] = await sql<{ id: number }[]>`
        INSERT INTO raw_items
          (source_type, external_id, title, url, author, metadata)
        VALUES
          (${sourceType}, ${externalId}, ${title}, ${url}, ${author}, ${sql.json(metadata)})
        RETURNING id
      `;
      inserted.push({ id: row.id });

      const ref: RankedItemRef = {
        rawItemId: row.id,
        score: rand(),
        rationale: "synthetic",
      };
      rankedItems.push(ref);

      rawItemsById.set(row.id, {
        id: row.id,
        title,
        url,
        sourceType,
        author,
        metadata,
      });
    }

    const digestHeadline = `Daily ${buildText(rand, 5)}`;
    const digestSummary = `${SYNTHETIC_MARKER} ${buildText(rand, 25)}`;

    const searchInput: ArchiveSearchInput = {
      digestHeadline,
      digestSummary,
      rankedItems,
      rawItemsById,
    };
    const searchText = serializeArchiveSearchText(searchInput);

    const archiveId = randomUUID();
    const completedAt = new Date(
      Date.now() - randomInt(0, 365 * 24 * 60 * 60 * 1000, rand),
    );

    await sql`
      INSERT INTO run_archives
        (id, status, ranked_items, top_n, reviewed, completed_at, digest_headline, digest_summary, search_text)
      VALUES
        (${archiveId}, 'completed', ${sql.json(rankedItems)}, ${itemCount}, true,
         ${completedAt}, ${digestHeadline}, ${digestSummary}, ${searchText})
    `;

    if ((i + 1) % 100 === 0) {
      console.log(`[seed] ${i + 1}/${N_ARCHIVES} archives inserted`);
    }
  }

  console.log(
    `[seed] done in ${(Date.now() - startedAt).toString()}ms`,
  );
}

async function teardown(sql: postgres.Sql, silent = false): Promise<void> {
  if (!silent) console.log(`[teardown] removing synthetic rows ...`);
  const archives = await sql`
    DELETE FROM run_archives
    WHERE digest_summary LIKE ${"%" + SYNTHETIC_MARKER + "%"}
    RETURNING id
  `;
  const items = await sql`
    DELETE FROM raw_items
    WHERE title LIKE ${"%" + SYNTHETIC_MARKER + "%"}
    RETURNING id
  `;
  if (!silent) {
    console.log(
      `[teardown] removed ${archives.length.toString()} archives, ${items.length.toString()} raw_items`,
    );
  }
}

interface PerfReport {
  n_archives: number;
  n_queries: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  p95_threshold_ms: number;
  passed: boolean;
  captured_at: string;
  tokens_sampled: string[];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.floor((sorted.length - 1) * p),
  );
  return sorted[idx];
}

async function bench(): Promise<PerfReport> {
  console.log(
    `[bench] running ${N_QUERIES} queries against ${API_BASE}/api/archives/search ...`,
  );
  const samples: number[] = [];
  const tokensUsed = new Set<string>();

  for (let i = 0; i < N_QUERIES; i++) {
    const token = TEST_TOKENS[i % TEST_TOKENS.length];
    tokensUsed.add(token);
    const url = `${API_BASE}/api/archives/search?q=${encodeURIComponent(token)}`;
    const t0 = performance.now();
    const r = await fetch(url);
    if (!r.ok) {
      throw new Error(
        `[bench] query ${i.toString()} failed: ${r.status.toString()} ${r.statusText}`,
      );
    }
    await r.json();
    samples.push(performance.now() - t0);
  }

  samples.sort((a, b) => a - b);
  const p50 = percentile(samples, 0.5);
  const p95 = percentile(samples, 0.95);
  const p99 = percentile(samples, 0.99);

  return {
    n_archives: N_ARCHIVES,
    n_queries: N_QUERIES,
    p50_ms: Math.round(p50 * 100) / 100,
    p95_ms: Math.round(p95 * 100) / 100,
    p99_ms: Math.round(p99 * 100) / 100,
    p95_threshold_ms: P95_THRESHOLD_MS,
    passed: p95 <= P95_THRESHOLD_MS,
    captured_at: new Date().toISOString(),
    tokens_sampled: Array.from(tokensUsed),
  };
}

function writeReport(report: PerfReport): void {
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
  console.log(`[bench] wrote report to ${REPORT_PATH}`);
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set");
    return 1;
  }
  const sql = postgres(databaseUrl);

  try {
    if (args.teardown) {
      await teardown(sql);
      return 0;
    }
    await seed(sql);
    const report = await bench();
    writeReport(report);
    console.log(JSON.stringify(report, null, 2));
    if (!report.passed) {
      console.error(
        `[bench] FAIL: P95 ${report.p95_ms.toString()}ms > threshold ${P95_THRESHOLD_MS.toString()}ms`,
      );
      return 1;
    }
    console.log(
      `[bench] PASS: P95 ${report.p95_ms.toString()}ms <= ${P95_THRESHOLD_MS.toString()}ms`,
    );
    return 0;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
