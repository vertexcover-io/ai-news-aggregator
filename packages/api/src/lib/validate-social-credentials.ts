import { z } from "zod";

export const linkedinUpsertSchema = z.object({
  clientId: z.string().trim().min(1),
  clientSecret: z.string().trim().min(1),
  apiVersion: z.string().trim().min(1).optional(),
});

export const twitterUpsertSchema = z.object({
  apiKey: z.string().trim().min(1),
  apiSecret: z.string().trim().min(1),
  accessToken: z.string().trim().min(1),
  accessTokenSecret: z.string().trim().min(1),
});

export const twitterCollectorUpsertSchema = z.object({
  apiKey: z.string().trim().min(1),
});

export type LinkedInUpsertBody = z.infer<typeof linkedinUpsertSchema>;
export type TwitterUpsertBody = z.infer<typeof twitterUpsertSchema>;
export type TwitterCollectorUpsertBody = z.infer<typeof twitterCollectorUpsertSchema>;
