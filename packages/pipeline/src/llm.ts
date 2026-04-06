import { GoogleGenAI } from "@google/genai";

export interface GeminiClient {
  generateContent(prompt: string): Promise<{ text: string | undefined }>;
}

export interface ArticleSelectors {
  title: string;
  content: string;
  author?: string;
  date?: string;
}

export function createGeminiClient(apiKey: string): GeminiClient {
  if (!apiKey || apiKey.trim() === "") {
    throw new Error("GEMINI_API_KEY is required and must not be empty");
  }

  const ai = new GoogleGenAI({ apiKey });

  return {
    async generateContent(prompt: string): Promise<{ text: string | undefined }> {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
      });
      return { text: response.text };
    },
  };
}

export function truncateHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
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

function validateArticleSelectors(parsed: unknown): ArticleSelectors {
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

  const result: ArticleSelectors = {
    title: obj.title,
    content: obj.content,
  };

  if (typeof obj.author === "string") {
    result.author = obj.author;
  }

  if (typeof obj.date === "string") {
    result.date = obj.date;
  }

  return result;
}

export async function extractArticleSelectors(
  html: string,
  client: GeminiClient,
): Promise<ArticleSelectors> {
  const truncated = truncateHtml(html);

  const prompt = `Analyze this HTML article page. Return CSS selectors as JSON:\n{"title": "selector for article title", "content": "selector for article body", "author": "selector for author or null", "date": "selector for publication date or null"}\nRules: Use only standard CSS selectors (tag, class, id, attribute). Do NOT use pseudo-elements (::before, ::after, etc.) or pseudo-classes (:nth-child, :first-of-type, etc.). Return ONLY valid JSON, no explanation.\nHTML: ${truncated}`;

  const response = await client.generateContent(prompt);

  if (!response.text) {
    throw new Error("Gemini returned empty response for selector extraction");
  }

  return validateArticleSelectors(parseJsonFromResponse(response.text));
}
