import { and, gte, inArray, sql } from "drizzle-orm";
import type IORedis from "ioredis";
import { rawItems } from "@newsletter/shared/db";
import type { AppDb, SourceType } from "@newsletter/shared/db";
import { runKey } from "@newsletter/shared";
import type {
  RawItemMetadata,
  RawItemSummary,
  RunState,
} from "@newsletter/shared";
import type { RunArchivesRepo } from "./run-archives.js";
import { NotFoundError } from "@api/lib/errors.js";

export interface RawItemRow {
  id: number;
  sourceType: SourceType;
  title: string;
  url: string;
  author: string | null;
  publishedAt: Date | null;
  engagement: { points: number; commentCount: number };
  content: string | null;
  imageUrl: string | null;
  metadata: RawItemMetadata;
}

export interface ListForRunDeps {
  archiveRepo: RunArchivesRepo;
  redis: Pick<IORedis, "get">;
}

export interface RawItemsRepo {
  findByIds(ids: number[]): Promise<RawItemRow[]>;
  listForRun(runId: string, deps: ListForRunDeps): Promise<RawItemSummary[]>;
}

export function createRawItemsRepo(
  db: Pick<AppDb, "select">,
): RawItemsRepo {
  return {
    async findByIds(ids: number[]): Promise<RawItemRow[]> {
      if (ids.length === 0) return [];
      const rows = await db
        .select({
          id: rawItems.id,
          sourceType: rawItems.sourceType,
          title: rawItems.title,
          url: rawItems.url,
          author: rawItems.author,
          publishedAt: rawItems.publishedAt,
          engagement: rawItems.engagement,
          content: rawItems.content,
          imageUrl: rawItems.imageUrl,
          metadata: rawItems.metadata,
        })
        .from(rawItems)
        .where(inArray(rawItems.id, ids));
      return rows;
    },
    async listForRun(
      runId: string,
      callDeps: ListForRunDeps,
    ): Promise<RawItemSummary[]> {
      return listRawItemsForRun(runId, { db, ...callDeps });
    },
  };
}

export interface ListRawItemsForRunDeps {
  db: Pick<AppDb, "select">;
  archiveRepo: RunArchivesRepo;
  redis: Pick<IORedis, "get">;
}

const SOURCE_KEY_TO_TYPE: Partial<Record<string, SourceType>> = {
  hn: "hn",
  reddit: "reddit",
  twitter: "twitter",
  blog: "blog",
  rss: "rss",
  github: "github",
  newsletter: "newsletter",
};

interface RunWindow {
  startedAt: Date;
  sourceTypes: SourceType[];
}

async function resolveRunWindow(
  runId: string,
  deps: ListRawItemsForRunDeps,
): Promise<RunWindow> {
  const archive = await deps.archiveRepo.findById(runId);
  if (archive?.startedAt && archive.sourceTypes) {
    return {
      startedAt: archive.startedAt,
      sourceTypes: archive.sourceTypes,
    };
  }
  const raw = await deps.redis.get(runKey(runId));
  if (raw === null) {
    throw new NotFoundError(`run not found: ${runId}`);
  }
  const state = JSON.parse(raw) as RunState;
  const sourceTypes: SourceType[] = Object.keys(state.sources)
    .map((k) => SOURCE_KEY_TO_TYPE[k])
    .filter((t): t is SourceType => t !== undefined);
  return {
    startedAt: new Date(state.startedAt),
    sourceTypes,
  };
}

export async function listRawItemsForRun(
  runId: string,
  deps: ListRawItemsForRunDeps,
): Promise<RawItemSummary[]> {
  const window = await resolveRunWindow(runId, deps);
  if (window.sourceTypes.length === 0) return [];

  const rows = await deps.db
    .select({
      id: rawItems.id,
      sourceType: rawItems.sourceType,
      title: rawItems.title,
      url: rawItems.url,
      author: rawItems.author,
      imageUrl: rawItems.imageUrl,
      publishedAt: rawItems.publishedAt,
      collectedAt: rawItems.collectedAt,
      engagement: rawItems.engagement,
    })
    .from(rawItems)
    .where(
      and(
        gte(rawItems.collectedAt, window.startedAt),
        inArray(rawItems.sourceType, window.sourceTypes),
      ),
    )
    .orderBy(
      sql`${rawItems.sourceType} ASC`,
      sql`COALESCE(${rawItems.publishedAt}, ${rawItems.collectedAt}) DESC`,
    );

  return rows.map((r) => ({
    id: r.id,
    sourceType: r.sourceType,
    title: r.title,
    url: r.url,
    author: r.author,
    imageUrl: r.imageUrl,
    publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
    collectedAt: r.collectedAt.toISOString(),
    engagement: r.engagement,
  }));
}
