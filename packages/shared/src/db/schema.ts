import { boolean, integer, jsonb, pgTable, serial, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type {
  NotificationState,
  RawItemEngagement,
  RawItemMetadata,
  RankedItemRef,
  RunSourceTelemetry,
  RunSubmitHnConfig,
  RunSubmitRedditConfig,
  RunSubmitTwitterConfig,
  RunSubmitWebConfig,
  SocialMetadata,
  SocialTokenMetadata,
} from "@shared/types/index.js";
import type { RunCostBreakdown } from "@shared/types/cost-breakdown.js";
import type { EncryptedBlob } from "@shared/services/credential-cipher.js";

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
  isDryRun: boolean("is_dry_run").notNull().default(false),
  completedAt: timestamp("completed_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at"),
  sourceTypes: jsonb("source_types").$type<SourceType[]>(),
  digestHeadline: text("digest_headline"),
  digestSummary: text("digest_summary"),
  hook: text("hook"),
  twitterSummary: text("twitter_summary"),
  sourceTelemetry: jsonb("source_telemetry").$type<RunSourceTelemetry | null>(),
  slackNotifiedAt: timestamp("slack_notified_at", { withTimezone: true }),
  searchText: text("search_text"),
  linkedinPostedAt: timestamp("linkedin_posted_at", { withTimezone: true }),
  twitterPostedAt: timestamp("twitter_posted_at", { withTimezone: true }),
  emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
  notificationState: jsonb("notification_state").$type<NotificationState | null>(),
  socialMetadata: jsonb("social_metadata").$type<SocialMetadata | null>(),
  costBreakdown: jsonb("cost_breakdown").$type<RunCostBreakdown | null>(),
});

export const socialTokens = pgTable("social_tokens", {
  platform: text("platform").primaryKey().$type<"linkedin" | "twitter">(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  metadata: jsonb("metadata").$type<SocialTokenMetadata | null>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SocialTokenInsert = typeof socialTokens.$inferInsert;
export type SocialTokenSelect = typeof socialTokens.$inferSelect;

export interface LinkedInEncryptedFields {
  clientId: EncryptedBlob;
  clientSecret: EncryptedBlob;
}

export interface TwitterEncryptedFields {
  apiKey: EncryptedBlob;
  apiSecret: EncryptedBlob;
  accessToken: EncryptedBlob;
  accessTokenSecret: EncryptedBlob;
}

export const socialCredentials = pgTable("social_credentials", {
  platform: text("platform").primaryKey().$type<"linkedin" | "twitter">(),
  encryptedFields: jsonb("encrypted_fields")
    .notNull()
    .$type<LinkedInEncryptedFields | TwitterEncryptedFields>(),
  metadata: jsonb("metadata").$type<{ apiVersion?: string } | null>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by"),
});

export type SocialCredentialInsert = typeof socialCredentials.$inferInsert;
export type SocialCredentialSelect = typeof socialCredentials.$inferSelect;

export type RunArchiveInsert = typeof runArchives.$inferInsert;

export const userSettings = pgTable(
  "user_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    singleton: boolean("singleton").notNull().default(true),
    topN: integer("top_n").notNull(),
    halfLifeHours: integer("half_life_hours"),
    hnEnabled: boolean("hn_enabled").notNull().default(false),
    hnConfig: jsonb("hn_config").$type<RunSubmitHnConfig | null>(),
    redditEnabled: boolean("reddit_enabled").notNull().default(false),
    redditConfig: jsonb("reddit_config").$type<RunSubmitRedditConfig | null>(),
    webEnabled: boolean("web_enabled").notNull().default(false),
    webConfig: jsonb("web_config").$type<RunSubmitWebConfig | null>(),
    twitterEnabled: boolean("twitter_enabled").notNull().default(false),
    twitterConfig: jsonb("twitter_config").$type<RunSubmitTwitterConfig | null>(),
    posthogEnabled: boolean("posthog_enabled").notNull().default(false),
    posthogProjectToken: text("posthog_project_token"),
    posthogHost: text("posthog_host"),
    pipelineTime: text("pipeline_time").notNull(),
    emailTime: text("email_time").notNull(),
    linkedinTime: text("linkedin_time").notNull(),
    twitterTime: text("twitter_time").notNull(),
    scheduleTimezone: text("schedule_timezone").notNull(),
    scheduleEnabled: boolean("schedule_enabled").notNull().default(false),
    emailEnabled: boolean("email_enabled").notNull().default(true),
    linkedinEnabled: boolean("linkedin_enabled").notNull().default(true),
    twitterPostEnabled: boolean("twitter_post_enabled").notNull().default(true),
    autoReview: boolean("auto_review").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("user_settings_singleton_uq").on(t.singleton)],
);

export type UserSettingsInsert = typeof userSettings.$inferInsert;
export type UserSettingsSelect = typeof userSettings.$inferSelect;

export type SubscriberStatus = "pending" | "confirmed" | "unsubscribed" | "bounced" | "complained";

export const subscribers = pgTable("subscribers", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  status: text("status").$type<SubscriberStatus>().notNull().default("pending"),
  confirmToken: text("confirm_token"),
  confirmTokenExpiresAt: timestamp("confirm_token_expires_at"),
  subscribedAt: timestamp("subscribed_at"),
  unsubscribedAt: timestamp("unsubscribed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("subscribers_email_uq").on(t.email),
]);

export type SubscriberInsert = typeof subscribers.$inferInsert;
export type SubscriberSelect = typeof subscribers.$inferSelect;

export const emailSends = pgTable("email_sends", {
  id: uuid("id").primaryKey().defaultRandom(),
  subscriberId: uuid("subscriber_id").notNull().references(() => subscribers.id),
  runArchiveId: uuid("run_archive_id").notNull().references(() => runArchives.id),
  messageId: text("message_id"),
  sentAt: timestamp("sent_at").notNull().defaultNow(),
}, (t) => [
  unique("email_sends_subscriber_archive_uq").on(t.subscriberId, t.runArchiveId),
]);

export type EmailSendInsert = typeof emailSends.$inferInsert;
export type EmailSendSelect = typeof emailSends.$inferSelect;

export type SesEventType = "delivery" | "bounce" | "complaint" | "open" | "click" | "reject";

export const sesEvents = pgTable("ses_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  messageId: text("message_id").notNull(),
  eventType: text("event_type").$type<SesEventType>().notNull(),
  subscriberId: uuid("subscriber_id"),
  rawPayload: jsonb("raw_payload").notNull(),
  occurredAt: timestamp("occurred_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  unique("ses_events_message_type_uq").on(t.messageId, t.eventType),
]);

export type SesEventInsert = typeof sesEvents.$inferInsert;
export type SesEventSelect = typeof sesEvents.$inferSelect;
