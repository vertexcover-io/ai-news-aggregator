import { integer, jsonb, pgTable, serial, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { RawItemEngagement, RawItemMetadata, RankedItemRef } from "@shared/types/index.js";

export type SourceType = "hn" | "reddit" | "twitter" | "rss" | "github" | "blog" | "newsletter";

export const rawItems = pgTable("raw_items", {
  id: serial("id").primaryKey(),
  sourceType: text("source_type").$type<SourceType>().notNull(),
  externalId: text("external_id").notNull(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  sourceUrl: text("source_url"),
  author: text("author"),
  content: text("content"),
  imageUrl: text("image_url"),
  publishedAt: timestamp("published_at"),
  collectedAt: timestamp("collected_at").notNull().defaultNow(),
  engagement: jsonb("engagement").$type<RawItemEngagement>().notNull().default({ points: 0, commentCount: 0 }),
  metadata: jsonb("metadata").$type<RawItemMetadata>().notNull().default({ comments: [] }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  unique("raw_items_source_type_external_id_unique").on(t.sourceType, t.externalId),
]);

export type RawItemInsert = typeof rawItems.$inferInsert;

export const runArchives = pgTable("run_archives", {
  id: uuid("id").primaryKey(),
  status: text("status").$type<"completed" | "failed">().notNull(),
  rankedItems: jsonb("ranked_items").$type<RankedItemRef[]>().notNull(),
  topN: integer("top_n").notNull(),
  profileName: text("profile_name"),
  completedAt: timestamp("completed_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type RunArchiveInsert = typeof runArchives.$inferInsert;
