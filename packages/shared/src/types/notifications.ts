export type NotificationKey =
  | "reviewPending"
  | "reviewWarning"
  | "emailFailure"
  | "linkedinFailure"
  | "twitterFailure"
  | "sourceDistribution"
  | "emailDelivery"
  | "linkedinPosted"
  | "twitterPosted"
  | "runCrashed"
  | "reviewPendingEmail"
  | "runCrashedEmail";

export type NotificationState = Partial<Record<NotificationKey, string>>;
