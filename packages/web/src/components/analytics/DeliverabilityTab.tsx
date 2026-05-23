import { useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAnalytics } from "@/api/analytics";

interface MetricCardProps {
  label: string;
  value: number;
  description?: string;
}

function MetricCard({ label, value, description }: MetricCardProps): ReactElement {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-6">
      <p className="font-mono text-xs uppercase tracking-widest text-neutral-500">
        {label}
      </p>
      <p className="mt-2 font-serif text-3xl text-neutral-900">
        {value.toLocaleString()}
      </p>
      {description && (
        <p className="mt-1 text-sm text-neutral-500">{description}</p>
      )}
    </div>
  );
}

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

function thirtyDaysAgoString(): string {
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

export function DeliverabilityTab(): ReactElement {
  const [from, setFrom] = useState(thirtyDaysAgoString);
  const [to, setTo] = useState(todayString);
  const [granularity, setGranularity] = useState<
    "daily" | "weekly" | "monthly"
  >("daily");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["analytics", from, to, granularity],
    queryFn: () => fetchAnalytics({ from, to, granularity }),
  });

  return (
    <div className="space-y-6">
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
            onChange={(e) => {
              setFrom(e.target.value);
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
            onChange={(e) => {
              setTo(e.target.value);
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
            onChange={(e) => {
              setGranularity(
                e.target.value as "daily" | "weekly" | "monthly",
              );
            }}
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
            <div
              key={`skel-${String(i)}`}
              className="h-24 animate-pulse bg-neutral-100 rounded-lg"
            />
          ))}
        </div>
      )}
      {isError && (
        <p className="text-sm text-red-600">Failed to load analytics.</p>
      )}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <MetricCard label="Subscriptions" value={data.totalSubscriptions} />
          <MetricCard
            label="Unsubscriptions"
            value={data.totalUnsubscriptions}
          />
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
