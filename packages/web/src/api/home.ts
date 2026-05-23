import type { HomePagePayload } from "@newsletter/shared/types";
import { apiFetch } from "./client";

export async function getHome(): Promise<HomePagePayload> {
  const res = await apiFetch("/api/home");
  if (!res.ok) throw new Error(`getHome: ${String(res.status)}`);
  return (await res.json()) as HomePagePayload;
}
