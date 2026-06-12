import { desc } from "drizzle-orm";
import { bigserial, boolean, customType, index, integer, jsonb, pgTable, primaryKey, serial, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type {
  NotificationState,
  RawItemEngagement,
  RawItemMetadata,
  RankedItemRef,
  RunFunnel,
  RunLogContext,
  RunLogEvent,
  RunLogLevel,
  RunSourceTelemetry,
  RunSubmitHnConfig,
  RunSubmitRedditConfig,
  RunSubmitTwitterConfig,
  RunSubmitWebConfig,
  RunSubmitWebSearchConfig,
  RunSubmitWebSource,
  SocialMetadata,
  SocialTokenMetadata,
  WebSearchQueryConfig,
} from "@shared/types/index.js";
import type { RunCostBreakdown } from "@shared/types/cost-breakdown.js";
import type { EncryptedBlob } from "@shared/services/credential-cipher.js";
import type { EditType, PreReviewSnapshot } from "@shared/review-edits/types.js";

export type SourceType = "hn" | "reddit" | "twitter" | "rss" | "github" | "blog" | "newsletter" | "web_search";

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export type TenantStatus = "pending_setup" | "active";

export interface TenantOnboarding {
  furthestStep: number;
  completed: string[];
  /** Newsletter description typed for prompt generation; persists so the
   * wizard's resume path keeps the discovery topic (REQ-032). */
  description?: string;
}

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  previousSlug: text("previous_slug"),
  name: text("name").notNull(),
  status: text("status").$type<TenantStatus>().notNull().default("pending_setup"),
  headline: text("headline"),
  topicStrip: text("topic_strip"),
  subtagline: text("subtagline"),
  logo: bytea("logo"),
  logoContentType: text("logo_content_type"),
  logoVersion: integer("logo_version").notNull().default(0),
  canonEnabled: boolean("canon_enabled").notNull().default(false),
  deliverabilityEnabled: boolean("deliverability_enabled").notNull().default(false),
  evalEnabled: boolean("eval_enabled").notNull().default(false),
  onboarding: jsonb("onboarding").$type<TenantOnboarding | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TenantInsert = typeof tenants.$inferInsert;
export type TenantSelect = typeof tenants.$inferSelect;

export type UserRole = "tenant_admin" | "super_admin";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    email: text("email").notNull().unique(),
    name: text("name"),
    passwordHash: text("password_hash").notNull(),
    role: text("role").$type<UserRole>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_tenant_id_uq").on(t.tenantId)],
);

export type UserInsert = typeof users.$inferInsert;
export type UserSelect = typeof users.$inferSelect;

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PasswordResetTokenInsert = typeof passwordResetTokens.$inferInsert;
export type PasswordResetTokenSelect = typeof passwordResetTokens.$inferSelect;

export const impersonationEvents = pgTable("impersonation_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  superAdminUserId: uuid("super_admin_user_id").notNull().references(() => users.id),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  action: text("action").$type<"start" | "stop">().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ImpersonationEventInsert = typeof impersonationEvents.$inferInsert;
export type ImpersonationEventSelect = typeof impersonationEvents.$inferSelect;

export type SendingDomainStatus = "pending" | "verified" | "failed";

export interface SendingDomainDnsRecord {
  record: string;
  name: string;
  type: string;
  value: string;
  status?: string;
}

export const sendingDomains = pgTable("sending_domains", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id).unique(),
  domain: text("domain").notNull(),
  resendDomainId: text("resend_domain_id"),
  status: text("status").$type<SendingDomainStatus>().notNull().default("pending"),
  dnsRecords: jsonb("dns_records").$type<SendingDomainDnsRecord[] | null>(),
  failureReason: text("failure_reason"),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SendingDomainInsert = typeof sendingDomains.$inferInsert;
export type SendingDomainSelect = typeof sendingDomains.$inferSelect;

export type TenantSourceType = "hn" | "reddit" | "web" | "twitter" | "web_search";

export interface SourceRedditConfig {
  subreddit: string;
  sort?: "hot" | "new" | "top";
  limit?: number;
  sinceDays: number;
}

export type SourceTwitterConfig =
  | { kind: "list"; listId: string }
  | { kind: "user"; handle: string; userId: string };

export type SourceConfig =
  | RunSubmitHnConfig
  | SourceRedditConfig
  | RunSubmitWebSource
  | SourceTwitterConfig
  | WebSearchQueryConfig;

export interface SourceHealth {
  status: "ok" | "failing";
  lastCheckedAt: string;
  message?: string;
}

export const sources = pgTable(
  "sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    type: text("type").$type<TenantSourceType>().notNull(),
    config: jsonb("config").$type<SourceConfig>().notNull(),
    enabled: boolean("enabled").notNull().default(true),
    health: jsonb("health").$type<SourceHealth | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sources_tenant_id_type_idx").on(t.tenantId, t.type)],
);

export type SourceInsert = typeof sources.$inferInsert;
export type SourceSelect = typeof sources.$inferSelect;

export const rawItems = pgTable("raw_items", {
  id: serial("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
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
  runId: uuid("run_id"),
}, (t) => [
  unique("raw_items_tenant_source_type_external_id_unique").on(t.tenantId, t.sourceType, t.externalId),
  index("raw_items_run_id_idx").on(t.runId),
  index("raw_items_tenant_id_idx").on(t.tenantId),
]);

export type RawItemInsert = typeof rawItems.$inferInsert;

export const runArchives = pgTable("run_archives", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
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
  linkedinPostBody: text("linkedin_post_body"),
  sourceTelemetry: jsonb("source_telemetry").$type<RunSourceTelemetry | null>(),
  slackNotifiedAt: timestamp("slack_notified_at", { withTimezone: true }),
  searchText: text("search_text"),
  linkedinPostedAt: timestamp("linkedin_posted_at", { withTimezone: true }),
  twitterPostedAt: timestamp("twitter_posted_at", { withTimezone: true }),
  emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  draftSavedAt: timestamp("draft_saved_at", { withTimezone: true }),
  notificationState: jsonb("notification_state").$type<NotificationState | null>(),
  socialMetadata: jsonb("social_metadata").$type<SocialMetadata | null>(),
  costBreakdown: jsonb("cost_breakdown").$type<RunCostBreakdown | null>(),
  runFunnel: jsonb("run_funnel").$type<RunFunnel | null>(),
  shortlistedItemIds: jsonb("shortlisted_item_ids").$type<number[] | null>(),
  preReviewSnapshot: jsonb("pre_review_snapshot").$type<PreReviewSnapshot | null>(),
}, (t) => [index("run_archives_tenant_id_idx").on(t.tenantId)]);

export const runLogs = pgTable(
  "run_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    runId: uuid("run_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    level: text("level").$type<RunLogLevel>().notNull(),
    stage: text("stage").notNull(),
    source: text("source"),
    event: text("event").$type<RunLogEvent>().notNull(),
    message: text("message").notNull(),
    context: jsonb("context").$type<RunLogContext | null>(),
  },
  (t) => [
    index("run_logs_run_id_id_idx").on(t.runId, t.id),
    index("run_logs_tenant_id_idx").on(t.tenantId),
  ],
);

export type RunLogRow = typeof runLogs.$inferSelect;
export type RunLogInsertRow = typeof runLogs.$inferInsert;

export interface SocialTokenEncryptedFields {
  accessToken: EncryptedBlob;
  refreshToken: EncryptedBlob;
}

export const socialTokens = pgTable(
  "social_tokens",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    platform: text("platform").$type<"linkedin" | "twitter">().notNull(),
    encryptedFields: jsonb("encrypted_fields")
      .notNull()
      .$type<SocialTokenEncryptedFields>(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    metadata: jsonb("metadata").$type<SocialTokenMetadata | null>(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.platform] })],
);

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

export interface TwitterCollectorEncryptedFields {
  apiKey: EncryptedBlob;
}

export type SocialCredentialPlatform = "linkedin" | "twitter" | "twitter_collector";

export const socialCredentials = pgTable(
  "social_credentials",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    platform: text("platform").$type<SocialCredentialPlatform>().notNull(),
    encryptedFields: jsonb("encrypted_fields")
      .notNull()
      .$type<
        LinkedInEncryptedFields | TwitterEncryptedFields | TwitterCollectorEncryptedFields
      >(),
    metadata: jsonb("metadata").$type<{ apiVersion?: string } | null>(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by"),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.platform] })],
);

export type SocialCredentialInsert = typeof socialCredentials.$inferInsert;
export type SocialCredentialSelect = typeof socialCredentials.$inferSelect;

export type RunArchiveInsert = typeof runArchives.$inferInsert;

export const userSettings = pgTable(
  "user_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    singleton: boolean("singleton").notNull().default(true),
    topN: integer("top_n").notNull(),
    shortlistSize: integer("shortlist_size").notNull(),
    halfLifeHours: integer("half_life_hours"),
    hnEnabled: boolean("hn_enabled").notNull().default(false),
    hnConfig: jsonb("hn_config").$type<RunSubmitHnConfig | null>(),
    redditEnabled: boolean("reddit_enabled").notNull().default(false),
    redditConfig: jsonb("reddit_config").$type<RunSubmitRedditConfig | null>(),
    webEnabled: boolean("web_enabled").notNull().default(false),
    webConfig: jsonb("web_config").$type<RunSubmitWebConfig | null>(),
    twitterEnabled: boolean("twitter_enabled").notNull().default(false),
    twitterConfig: jsonb("twitter_config").$type<RunSubmitTwitterConfig | null>(),
    webSearchEnabled: boolean("web_search_enabled").notNull().default(false),
    webSearchConfig: jsonb("web_search_config").$type<RunSubmitWebSearchConfig | null>(),
    posthogEnabled: boolean("posthog_enabled").notNull().default(false),
    posthogProjectToken: text("posthog_project_token"),
    posthogHost: text("posthog_host"),
    rankingPrompt: text("ranking_prompt").notNull(),
    shortlistPrompt: text("shortlist_prompt").notNull(),
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
    notificationEmail: text("notification_email"),
    slackWebhookEncrypted: jsonb("slack_webhook_encrypted").$type<EncryptedBlob | null>(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("user_settings_tenant_uq").on(t.tenantId)],
);

export type UserSettingsInsert = typeof userSettings.$inferInsert;
export type UserSettingsSelect = typeof userSettings.$inferSelect;

export const mustReadEntries = pgTable(
  "must_read_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    url: text("url").notNull(),
    title: text("title").notNull(),
    author: text("author"),
    year: integer("year"),
    annotation: text("annotation").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("must_read_entries_added_at_idx").on(desc(t.addedAt)),
    unique("must_read_entries_tenant_url_unique").on(t.tenantId, t.url),
  ],
);

export type MustReadEntry = typeof mustReadEntries.$inferSelect;
export type MustReadEntryInsert = typeof mustReadEntries.$inferInsert;

export type SubscriberStatus = "pending" | "confirmed" | "unsubscribed" | "bounced" | "complained";

export const subscribers = pgTable("subscribers", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  email: text("email").notNull(),
  status: text("status").$type<SubscriberStatus>().notNull().default("pending"),
  confirmToken: text("confirm_token"),
  confirmTokenExpiresAt: timestamp("confirm_token_expires_at"),
  subscribedAt: timestamp("subscribed_at"),
  unsubscribedAt: timestamp("unsubscribed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("subscribers_tenant_email_uq").on(t.tenantId, t.email),
  index("subscribers_tenant_id_idx").on(t.tenantId),
]);

export type SubscriberInsert = typeof subscribers.$inferInsert;
export type SubscriberSelect = typeof subscribers.$inferSelect;

export const emailSends = pgTable("email_sends", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  subscriberId: uuid("subscriber_id").notNull().references(() => subscribers.id),
  runArchiveId: uuid("run_archive_id").notNull().references(() => runArchives.id),
  messageId: text("message_id"),
  sentAt: timestamp("sent_at").notNull().defaultNow(),
}, (t) => [
  unique("email_sends_subscriber_archive_uq").on(t.subscriberId, t.runArchiveId),
  index("email_sends_tenant_id_idx").on(t.tenantId),
]);

export type EmailSendInsert = typeof emailSends.$inferInsert;
export type EmailSendSelect = typeof emailSends.$inferSelect;

export type FeedbackRating = "love" | "meh" | "nah";

// Append-only log of reader-feedback clicks (one-tap emoji links in feedback
// campaigns). Multiple rows per subscriber are expected and fine — a scanner
// prefetching all three links shows up as a burst of conflicting ratings within
// seconds, which the read-side resolver discards. The clean tally is derived,
// never upserted in place.
export const feedbackEvents = pgTable("feedback_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  subscriberId: uuid("subscriber_id").notNull().references(() => subscribers.id),
  campaign: text("campaign").notNull(),
  rating: text("rating").$type<FeedbackRating>().notNull(),
  userAgent: text("user_agent"),
  ip: text("ip"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("feedback_events_subscriber_campaign_idx").on(t.subscriberId, t.campaign),
]);

export type FeedbackEventInsert = typeof feedbackEvents.$inferInsert;
export type FeedbackEventSelect = typeof feedbackEvents.$inferSelect;

export type SesEventType = "delivery" | "bounce" | "complaint" | "open" | "click" | "reject";

export const sesEvents = pgTable("ses_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
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

export const evalRuns = pgTable("eval_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  mode: text("mode").notNull(),
  fixtureId: text("fixture_id"),
  date: text("date"),
  windowSize: integer("window_size"),
  draftPromptHash: text("draft_prompt_hash").notNull(),
  draftPromptSnapshot: text("draft_prompt_snapshot").notNull(),
  savedPromptHash: text("saved_prompt_hash"),
  savedPromptSnapshot: text("saved_prompt_snapshot"),
  status: text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  scoreBreakdown: jsonb("score_breakdown"),
  costBreakdown: jsonb("cost_breakdown"),
  errorMessage: text("error_message"),
}, (t) => [
  index("eval_runs_started_at_idx").on(t.startedAt.desc()),
  index("eval_runs_prompt_hash_idx").on(t.draftPromptHash),
]);

export type EvalRunInsert = typeof evalRuns.$inferInsert;
export type EvalRunSelect = typeof evalRuns.$inferSelect;

export const reviewEdits = pgTable("review_edits", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  runId: uuid("run_id").notNull().references(() => runArchives.id, { onDelete: "cascade" }),
  editType: text("edit_type").$type<EditType>().notNull(),
  rawItemId: integer("raw_item_id"),
  field: text("field"),
  before: jsonb("before"),
  after: jsonb("after"),
  positionBefore: integer("position_before"),
  positionAfter: integer("position_after"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("review_edits_run_id_idx").on(t.runId),
  index("review_edits_edit_type_idx").on(t.editType),
]);

export type ReviewEditInsert = typeof reviewEdits.$inferInsert;
export type ReviewEditSelect = typeof reviewEdits.$inferSelect;
