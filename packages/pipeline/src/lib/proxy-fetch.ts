import { ProxyAgent } from "undici";

export function createProxyFetch(proxyUrl: string | undefined): typeof fetch {
  if (!proxyUrl || proxyUrl.trim() === "") {
    return globalThis.fetch;
  }

  const agent = new ProxyAgent(proxyUrl.trim());

  return ((input, init) => {
    const merged = { ...(init ?? {}), dispatcher: agent } as RequestInit;
    return globalThis.fetch(input, merged);
  }) as typeof fetch;
}
