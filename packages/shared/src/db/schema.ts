import { boolean, integer, jsonb, pgEnum, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";

export const sourceTypeEnum = pgEnum("source_type", [
  "hn",
  "reddit",
  "twitter",
  "rss",
  "github",
  "blog",
  "newsletter",
]);

export const sources = pgTable("sources", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  type: sourceTypeEnum("type").notNull(),
  url: text("url").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const rawItems = pgTable("raw_items", {
  id: serial("id").primaryKey(),
  sourceId: integer("source_id").references(() => sources.id),
  sourceType: sourceTypeEnum("source_type").notNull(),
  externalId: text("external_id").notNull(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  sourceUrl: text("source_url"),
  author: text("author"),
  content: text("content"),
  publishedAt: timestamp("published_at"),
  collectedAt: timestamp("collected_at").notNull().defaultNow(),
  engagement: jsonb("engagement").notNull().default({}),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  unique("raw_items_source_type_external_id_unique").on(t.sourceType, t.externalId),
]);
