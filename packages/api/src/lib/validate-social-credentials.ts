import { z } from "zod";

export const linkedinUpsertSchema = z.object({
  clientId: z.string().trim().min(1),
  clientSecret: z.string().trim().min(1),
  apiVersion: z.string().trim().min(1).optional(),
});

export const twitterCollectorUpsertSchema = z.object({
  apiKey: z.string().trim().min(1),
});

