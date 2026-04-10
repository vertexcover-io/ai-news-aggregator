import { apiFetch } from "./client";

interface ProfilesResponse {
  profiles: string[];
}

export async function fetchProfiles(): Promise<string[]> {
  const res = await apiFetch("/api/profiles");
  if (!res.ok) throw new Error("Failed to fetch profiles");
  const body = (await res.json()) as ProfilesResponse;
  return body.profiles;
}
