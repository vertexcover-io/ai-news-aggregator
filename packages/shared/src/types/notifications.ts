export type NotificationKey =
  | "reviewPending"
  | "reviewWarning"
  | "emailFailure"
  | "linkedinFailure"
  | "twitterFailure";

export type NotificationState = Partial<Record<NotificationKey, string>>;
