export type NotificationKey =
  | "reviewPending"
  | "reviewPendingEmail"
  | "reviewWarning"
  | "emailFailure"
  | "linkedinFailure"
  | "twitterFailure"
  | "sourceDistribution"
  | "emailDelivery"
  | "linkedinPosted"
  | "twitterPosted";

export type NotificationState = Partial<Record<NotificationKey, string>>;
