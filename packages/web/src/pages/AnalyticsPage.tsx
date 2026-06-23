import { type ReactElement } from "react";
import { useSearchParams } from "react-router-dom";
import { DeliverabilityTab } from "@/components/analytics/DeliverabilityTab";
import { SourcesTab } from "@/components/analytics/SourcesTab";
import { FeatureDisabledNotice } from "@/components/admin/FeatureDisabledNotice";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";

type TabId = "deliverability" | "sources";

function readTab(params: URLSearchParams): TabId {
  return params.get("tab") === "sources" ? "sources" : "deliverability";
}

export function AnalyticsPage(): ReactElement {
  const [params, setParams] = useSearchParams();
  const tab = readTab(params);
  const { data: flags, isLoading: flagsLoading } = useFeatureFlags();
  // Deliverability is flag-gated (Fix #4). Block on an explicit `false`; while
  // the flag is still loading we render nothing for the tab rather than mount
  // DeliverabilityTab (which would fire a request the API gate then 403s).
  const deliverabilityDisabled = flags?.featureDeliverability === false;

  const setTab = (next: TabId): void => {
    const p = new URLSearchParams(params);
    if (next === "deliverability") p.delete("tab");
    else p.set("tab", next);
    setParams(p, { replace: true });
  };

  return (
    <div className="space-y-6 p-4 sm:p-6 md:p-8">
      <div>
        <h1 className="font-serif text-2xl text-neutral-900">Analytics</h1>
        <p className="mt-1 font-mono text-xs uppercase tracking-widest text-neutral-500">
          Email performance and source health
        </p>
      </div>

      <div
        role="tablist"
        aria-label="Analytics sections"
        className="flex gap-0 border-b border-neutral-200"
      >
        <TabButton
          active={tab === "deliverability"}
          onClick={() => {
            setTab("deliverability");
          }}
        >
          Deliverability
        </TabButton>
        <TabButton
          active={tab === "sources"}
          onClick={() => {
            setTab("sources");
          }}
        >
          Sources
        </TabButton>
      </div>

      {tab === "deliverability" ? (
        deliverabilityDisabled ? (
          <FeatureDisabledNotice featureLabel="Deliverability analytics" />
        ) : flagsLoading ? null : (
          <DeliverabilityTab />
        )
      ) : (
        <SourcesTab />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactElement | string;
}): ReactElement {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={[
        "font-mono text-[11.5px] uppercase tracking-[0.18em] px-4 py-2.5 -mb-px border-b-2 cursor-pointer",
        active
          ? "border-[#8c3a1e] text-[#8c3a1e]"
          : "border-transparent text-neutral-500 hover:text-neutral-900",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
