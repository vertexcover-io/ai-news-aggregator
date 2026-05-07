export interface BaseUrls {
  baseUrl: string;
  webBaseUrl: string;
}

export type BaseUrlEnv = Record<string, string | undefined>;

export function resolveBaseUrls(env: BaseUrlEnv): BaseUrls {
  const port = env.API_PORT ?? "3000";
  const localhost = `http://localhost:${port}`;
  const webBaseUrl = env.NEWSLETTER_BASE_URL ?? env.BASE_URL ?? localhost;
  const baseUrl = env.BASE_URL ?? webBaseUrl;
  return { baseUrl, webBaseUrl };
}
