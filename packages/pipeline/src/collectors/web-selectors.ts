import { GoogleGenAI } from "@google/genai";
import type { WebSourceSelectors } from "@pipeline/types.js";

export interface GeminiClient {
  generateContent(prompt: string): Promise<{ text: string | undefined }>;
}

export function createGeminiClient(apiKey: string): GeminiClient {
  if (!apiKey || apiKey.trim() === "") {
    throw new Error("GEMINI_API_KEY is required and must not be empty");
  }

  const ai = new GoogleGenAI({ apiKey });

  return {
    async generateContent(prompt: string): Promise<{ text: string | undefined }> {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-lite",
        contents: prompt,
      });
      return { text: response.text };
    },
  };
}

export function truncateHtml(html: string, maxLength = 15000): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");

  if (stripped.length <= maxLength) {
    return stripped;
  }

  return stripped.slice(0, maxLength);
}

function parseJsonFromResponse(text: string): unknown {
  const codeBlockMatch = (/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/).exec(text);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1] : text;

  try {
    return JSON.parse(jsonStr);
  } catch {
    throw new Error(`Failed to parse LLM response as JSON: ${text.slice(0, 200)}`);
  }
}

function validateIndexSelectors(parsed: unknown): Partial<WebSourceSelectors> {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Failed to parse LLM response: expected an object");
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.articleLink !== "string" || obj.articleLink === "") {
    throw new Error("Missing required field: articleLink must be a non-empty string");
  }
  return { articleLink: obj.articleLink };
}

function validateArticleSelectors(parsed: unknown): Partial<WebSourceSelectors> {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Failed to parse LLM response: expected an object");
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.title !== "string" || obj.title === "") {
    throw new Error("Missing required field: title must be a non-empty string");
  }
  if (typeof obj.content !== "string" || obj.content === "") {
    throw new Error("Missing required field: content must be a non-empty string");
  }

  const result: Partial<WebSourceSelectors> = {
    title: obj.title,
    content: obj.content,
  };

  if (typeof obj.author === "string") {
    result.author = obj.author;
  } else if (obj.author === null || obj.author === undefined) {
    result.author = obj.author as undefined;
  }

  if (typeof obj.date === "string") {
    result.date = obj.date;
  } else if (obj.date === null || obj.date === undefined) {
    result.date = obj.date as undefined;
  }

  return result;
}

export async function extractSelectors(
  html: string,
  context: "index" | "article",
  client: GeminiClient,
): Promise<Partial<WebSourceSelectors>> {
  const truncated = truncateHtml(html);

  const prompt =
    context === "index"
      ? `Analyze this HTML page which is a blog/news index page. Return CSS selectors as JSON:\n{"articleLink": "selector for <a> tags linking to articles"}\nOnly the articleLink field. Return ONLY valid JSON, no explanation.\nHTML: ${truncated}`
      : `Analyze this HTML article page. Return CSS selectors as JSON:\n{"title": "selector for article title", "content": "selector for article body", "author": "selector for author or null", "date": "selector for date or null"}\nReturn ONLY valid JSON, no explanation.\nHTML: ${truncated}`;

  const response = await client.generateContent(prompt);

  if (!response.text) {
    throw new Error("Gemini returned empty response for selector extraction");
  }

  const parsed = parseJsonFromResponse(response.text);

  if (context === "index") {
    return validateIndexSelectors(parsed);
  }
  return validateArticleSelectors(parsed);
}

export async function deriveSelectors(
  indexHtml: string,
  articleHtml: string,
  client: GeminiClient,
): Promise<WebSourceSelectors> {
  const indexSelectors = await extractSelectors(indexHtml, "index", client);
  const articleSelectors = await extractSelectors(articleHtml, "article", client);

  const articleLink = indexSelectors.articleLink;
  const title = articleSelectors.title;
  const content = articleSelectors.content;

  if (!articleLink || !title || !content) {
    throw new Error("LLM selector extraction returned incomplete selectors");
  }

  return {
    articleLink,
    title,
    content,
    ...(articleSelectors.author != null ? { author: articleSelectors.author } : {}),
    ...(articleSelectors.date != null ? { date: articleSelectors.date } : {}),
  };
}
