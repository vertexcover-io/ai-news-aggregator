export type SocialSkippedReason =
  | "no_headline"
  | "already_posted"
  | "not_configured"
  | "no_token";

export type SocialResult =
  | { status: "posted"; permalink: string | null }
  | { status: "skipped"; reason: SocialSkippedReason }
  | { status: "failed"; reason: string };
