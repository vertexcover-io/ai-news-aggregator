import type { WebSearchProviderName } from "@newsletter/shared/types";
import { TavilyProvider } from "./tavily.js";
import type { WebSearchProvider } from "./types.js";

export interface WebSearchProviderEnv {
  tavilyApiKey?: string;
}

export function createWebSearchProvider(
  _name: WebSearchProviderName,
  env: WebSearchProviderEnv,
): WebSearchProvider {
  if (!env.tavilyApiKey) {
    throw new Error("TAVILY_API_KEY is required for the tavily web-search provider");
  }
  return new TavilyProvider({ apiKey: env.tavilyApiKey });
}

export type { WebSearchProvider, WebSearchResult, SearchInput } from "./types.js";
