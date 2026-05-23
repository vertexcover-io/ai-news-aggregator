import { useMemo, useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAnalytics } from "@/api/analytics";
import { useSettings } from "../hooks/useSettings";
import {
  addDaysToIsoDate,
  configuredTimezone,
  todayInTimezone,
} from "../lib/dateSelectorTimezone";

interface MetricCardProps {
  label: string;
  value: number;
  description?: string;
}

function MetricCard({ label, value, description }: MetricCardProps): ReactElement {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-6">
      <p className="font-mono text-xs uppercase tracking-widest text-neutral-500">{label}</p>
      <p className="mt-2 font-serif text-3xl text-neutral-900">{value.toLocaleString()}</p>
      {description && <p className="mt-1 text-sm text-neutral-500">{description}</p>}
    </div>
  );
}

export function AnalyticsPage(): ReactElement {
  const settingsQuery = useSettings();
  const timezone = useMemo(
    () => configuredTimezone(settingsQuery.data?.scheduleTimezone),
    [settingsQuery.data?.scheduleTimezone],
  );
  const today = useMemo(() => todayInTimezone(timezone), [timezone]);
  const [fromOverride, setFromOverride] = useState<string | null>(null);
  const [toOverride, setToOverride] = useState<string | null>(null);
  const from = fromOverride ?? addDaysToIsoDate(today, -30);
  const to = toOverride ?? today;
  const [granularity, setGranularity] = useState<"daily" | "weekly" | "monthly">("daily");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["analytics", from, to, granularity],
    queryFn: () => fetchAnalytics({ from, to, granularity }),
  });

  return (
    <div className="space-y-6 p-4 sm:p-6 md:p-8">
      <div>
        <h1 className="font-serif text-2xl text-neutral-900">Deliverability Analytics</h1>
        <p className="mt-1 font-mono text-xs uppercase tracking-widest text-neutral-500">
          Email performance metrics
        </p>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label
            htmlFor="analytics-from"
            className="block text-xs font-mono uppercase tracking-widest text-neutral-500 mb-1"
          >
            From
          </label>
          <input
            id="analytics-from"
            type="date"
            value={from}
            max={to}
            onChange={(e) => {
              setFromOverride(e.target.value);
            }}
            className="border border-neutral-200 rounded px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label
            htmlFor="analytics-to"
            className="block text-xs font-mono uppercase tracking-widest text-neutral-500 mb-1"
          >
            To
          </label>
          <input
            id="analytics-to"
            type="date"
            value={to}
            max={today}
            onChange={(e) => {
              setToOverride(e.target.value);
            }}
            className="border border-neutral-200 rounded px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label
            htmlFor="analytics-granularity"
            className="block text-xs font-mono uppercase tracking-widest text-neutral-500 mb-1"
          >
            Granularity
          </label>
          <select
            id="analytics-granularity"
            value={granularity}
            onChange={(e) => { setGranularity(e.target.value as "daily" | "weekly" | "monthly"); }}
            className="border border-neutral-200 rounded px-3 py-1.5 text-sm self-end"
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
      </div>

      {isLoading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse bg-neutral-100 rounded-lg" />
          ))}
        </div>
      )}
      {isError && <p className="text-sm text-red-600">Failed to load analytics.</p>}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <MetricCard label="Subscriptions" value={data.totalSubscriptions} />
          <MetricCard label="Unsubscriptions" value={data.totalUnsubscriptions} />
          <MetricCard label="Emails Sent" value={data.emailsSent} />
          <MetricCard label="Bounces" value={data.bounces} />
          <MetricCard label="Spam Complaints" value={data.complaints} />
          <MetricCard label="Opens" value={data.opens} />
          <MetricCard label="Clicks" value={data.clicks} />
        </div>
      )}
    </div>
  );
}
