import { boolean, integer, jsonb, pgTable, serial, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type {
  RawItemEngagement,
  RawItemMetadata,
  RankedItemRef,
  RunSubmitHnConfig,
  RunSubmitRedditConfig,
  RunSubmitWebConfig,
} from "@shared/types/index.js";

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
  status: text("status").$type<"completed" | "failed" | "cancelled">().notNull(),
  rankedItems: jsonb("ranked_items").$type<RankedItemRef[]>().notNull(),
  topN: integer("top_n").notNull(),
  reviewed: boolean("reviewed").notNull().default(false),
  completedAt: timestamp("completed_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RunArchiveInsert = typeof runArchives.$inferInsert;

export const userSettings = pgTable(
  "user_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    singleton: boolean("singleton").notNull().default(true),
    topN: integer("top_n").notNull(),
    halfLifeHours: integer("half_life_hours"),
    hnConfig: jsonb("hn_config").$type<RunSubmitHnConfig | null>(),
    redditConfig: jsonb("reddit_config").$type<RunSubmitRedditConfig | null>(),
    webConfig: jsonb("web_config").$type<RunSubmitWebConfig | null>(),
    scheduleTime: text("schedule_time").notNull(),
    scheduleTimezone: text("schedule_timezone").notNull(),
    scheduleEnabled: boolean("schedule_enabled").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("user_settings_singleton_uq").on(t.singleton)],
);

export type UserSettingsInsert = typeof userSettings.$inferInsert;
export type UserSettingsSelect = typeof userSettings.$inferSelect;
