import { apiFetchAdmin } from "./client";

export type SocialPlatform = "linkedin" | "twitter";

export interface SocialStatus {
  linkedin: { configured: boolean };
  twitter: { configured: boolean };
}

export interface StartSocialTestPostResult {
  requestId: string;
}

export type SocialTestPostResult =
  | { status: "pending" }
  | { status: "posted"; permalink?: string }
  | { status: "failed"; error?: string };

export async function getSocialStatus(): Promise<SocialStatus> {
  const res = await apiFetchAdmin("/api/settings/social-status");
  if (!res.ok) throw new Error("Failed to fetch social status");
  return (await res.json()) as SocialStatus;
}

export async function startSocialTestPost(
  platform: SocialPlatform,
): Promise<StartSocialTestPostResult> {
  const res = await apiFetchAdmin("/api/settings/test-social-post", {
    method: "POST",
    body: JSON.stringify({ platform }),
  });
  if (!res.ok) throw new Error("Failed to start test post");
  return (await res.json()) as StartSocialTestPostResult;
}

export async function getSocialTestPostResult(
  requestId: string,
): Promise<SocialTestPostResult> {
  const res = await apiFetchAdmin(
    `/api/settings/test-social-post/${encodeURIComponent(requestId)}`,
  );
  if (!res.ok) throw new Error("Failed to fetch test post result");
  return (await res.json()) as SocialTestPostResult;
}
