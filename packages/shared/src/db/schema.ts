import { jsonb, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import type { RawItemEngagement, RawItemMetadata } from "@shared/types/index.js";

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
