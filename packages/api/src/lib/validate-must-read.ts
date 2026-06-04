import { z } from "zod";

export const previewSchema = z.object({
  url: z.url(),
});

const yearSchema = z
  .number()
  .int()
  .min(1900)
  .max(2100)
  .nullable();

const titleSchema = z.string().trim().min(1).max(500);
const authorSchema = z.string().trim().min(1).max(200).nullable();
const annotationSchema = z.string().trim().min(1).max(5000);

export const createSchema = z.object({
  url: z.url(),
  title: titleSchema,
  author: authorSchema,
  year: yearSchema,
  annotation: annotationSchema,
});

export const patchSchema = z
  .object({
    url: z.url().optional(),
    title: titleSchema.optional(),
    author: authorSchema.optional(),
    year: yearSchema.optional(),
    annotation: annotationSchema.optional(),
  })
  .refine(
    (value) =>
      value.url !== undefined ||
      value.title !== undefined ||
      value.author !== undefined ||
      value.year !== undefined ||
      value.annotation !== undefined,
    { message: "at least one field is required" },
  );

