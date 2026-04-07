import { generateText, Output } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";
import { createLogger } from "@newsletter/shared/logger";

const logger = createLogger("collector:web");

const JINA_BASE_URL = "https://r.jina.ai/";
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;
const MAX_ERROR_LENGTH = 200;

// Referenced by Phase 5 (failure logging + truncation); kept here to establish module constants.
void logger;
void MAX_ERROR_LENGTH;

export async function fetchMarkdown(
  url: string,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<string> {
  const jinaUrl = `${JINA_BASE_URL}${url}`;
  const headers: Record<string, string> = { Accept: "text/plain" };
  const apiKey = process.env.JINA_API_KEY;
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetchFn(jinaUrl, { headers });
      if (!response.ok) {
        const status = response.status;
        if (status >= 400 && status < 500 && status !== 429) {
          throw new Error(`Non-retryable HTTP ${status} for ${url}`);
        }
        throw new Error(`HTTP ${status} for ${url}`);
      }
      const raw = await response.text();
      return stripJinaEnvelope(raw);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (lastError.message.startsWith("Non-retryable")) throw lastError;
      if (attempt < MAX_RETRIES - 1) {
        await delay(Math.pow(2, attempt) * RETRY_BASE_DELAY_MS);
      }
    }
  }

  throw lastError ?? new Error(`fetchMarkdown failed after ${MAX_RETRIES} retries`);
}

const ENVELOPE_BODY_RE = /\nMarkdown Content:\n([\s\S]*)$/;

function stripJinaEnvelope(raw: string): string {
  const bodyMatch = ENVELOPE_BODY_RE.exec(raw);
  return (bodyMatch ? bodyMatch[1] : raw).trim();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const DiscoverySchema = z.object({
  posts: z.array(
    z.object({
      url: z.string(),
      title: z.string(),
      published_at: z.string(),
    }),
  ),
});

export const DetailSchema = z.object({
  title: z.string(),
  author: z.string(),
  published_at: z.string(),
});

export type DiscoveredPost = z.infer<typeof DiscoverySchema>["posts"][number];
export type ExtractedFields = z.infer<typeof DetailSchema>;

export async function discoverPostUrls(
  listingUrl: string,
  listingMarkdown: string,
  model: LanguageModel,
): Promise<DiscoveredPost[]> {
  const result = await generateText({
    model,
    output: Output.object({ schema: DiscoverySchema }),
    temperature: 0,
    prompt:
      `You are extracting blog posts from a listing page that has been ` +
      `converted to markdown. The listing URL is ${listingUrl}.\n\n` +
      `Return the actual blog post entries in the order they appear on the page ` +
      `(top = newest). Skip everything that is not a post: navigation, footer, ` +
      `social links, "related posts" sidebars, author bios, tag indexes, pagination.\n\n` +
      `Use empty strings for fields you cannot determine \u2014 never invent data.\n\n` +
      `--- BEGIN LISTING MARKDOWN ---\n${listingMarkdown}\n--- END LISTING MARKDOWN ---`,
  });
  return result.output.posts;
}

export async function extractPostFields(
  postUrl: string,
  postMarkdown: string,
  model: LanguageModel,
): Promise<ExtractedFields> {
  const result = await generateText({
    model,
    output: Output.object({ schema: DetailSchema }),
    temperature: 0,
    prompt:
      `Extract title, author, and publish date from this blog post markdown. ` +
      `The source URL is ${postUrl}. ` +
      `Use empty strings for fields not stated on the page \u2014 never invent data.\n\n` +
      `--- BEGIN ARTICLE ---\n${postMarkdown}\n--- END ARTICLE ---`,
  });
  return result.output;
}

export function validateDiscoveredUrls(
  posts: DiscoveredPost[],
  listingMarkdown: string,
): DiscoveredPost[] {
  return posts.filter((p) => listingMarkdown.includes(p.url));
}
