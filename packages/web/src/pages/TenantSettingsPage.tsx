import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Newspaper } from "lucide-react";
import { getTenantSettings } from "@/api/tenant-settings";
import { BrandingPanel } from "@/components/settings/tenant/BrandingPanel";
import { SourcesPanel } from "@/components/settings/tenant/SourcesPanel";
import { SendingDomainPanel } from "@/components/settings/tenant/SendingDomainPanel";
import { NotificationsPanel } from "@/components/settings/tenant/NotificationsPanel";
import { FeatureFlagsPanel } from "@/components/settings/tenant/FeatureFlagsPanel";

const SIDENAV = [
  { id: "branding", label: "Branding" },
  { id: "sources", label: "Sources" },
  { id: "domain", label: "Sending domain" },
  { id: "notify", label: "Notifications" },
  { id: "features", label: "Features" },
];

export function TenantSettingsPage(): ReactElement {
  const settingsQuery = useQuery({
    queryKey: ["tenant-settings"],
    queryFn: getTenantSettings,
    refetchOnWindowFocus: false,
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b bg-white px-4 sm:px-6 md:px-8 py-4">
        <Link
          to="/admin"
          className="inline-flex items-center gap-2 font-semibold min-h-[44px]"
        >
          <Newspaper className="size-5" />
          Newsletter
        </Link>
        <Link
          to="/admin"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground min-h-[44px]"
        >
          <ArrowLeft className="size-4" />
          Back to dashboard
        </Link>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 md:p-8">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Tenant settings
          </p>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        </div>

        <div className="grid gap-8 md:grid-cols-[180px_1fr]">
          <nav className="flex gap-1 overflow-auto md:sticky md:top-6 md:h-fit md:flex-col">
            {SIDENAV.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="rounded-md px-3 py-2 font-mono text-xs uppercase tracking-wider text-muted-foreground hover:bg-black/5 hover:text-foreground"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="space-y-6">
            {settingsQuery.isLoading && (
              <p className="text-sm text-muted-foreground">Loading settings…</p>
            )}
            {settingsQuery.isError && (
              <p className="text-sm text-red-600" role="alert">
                Failed to load settings.
              </p>
            )}
            {settingsQuery.data && (
              <>
                <BrandingPanel settings={settingsQuery.data} />
                <SourcesPanel />
                <SendingDomainPanel />
                <NotificationsPanel settings={settingsQuery.data} />
                <FeatureFlagsPanel settings={settingsQuery.data} />
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
