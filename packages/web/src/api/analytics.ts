import { apiFetchAdmin } from "./client.js";
import type { AnalyticsMetrics } from "@newsletter/shared";

export async function fetchAnalytics(params: {
  from?: string;
  to?: string;
  granularity?: "daily" | "weekly" | "monthly";
}): Promise<AnalyticsMetrics> {
  const query = new URLSearchParams();
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  if (params.granularity) query.set("granularity", params.granularity);
  const res = await apiFetchAdmin(`/api/admin/analytics?${query}`);
  if (!res.ok) throw new Error("Failed to fetch analytics");
  return res.json() as Promise<AnalyticsMetrics>;
}
