export type NotificationKey =
  | "reviewPending"
  | "reviewWarning"
  | "emailFailure"
  | "linkedinFailure"
  | "twitterFailure"
  | "sourceDistribution"
  | "emailDelivery"
  | "linkedinPosted"
  | "twitterPosted";

export type NotificationState = Partial<Record<NotificationKey, string>>;
