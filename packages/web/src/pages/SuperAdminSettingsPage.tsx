/**
 * Super-admin platform settings page (REQ-019 relocation, Phase 6).
 *
 * Accessible at /admin/platform — inside RequireSuperAdmin, so only
 * super_admin sessions reach this page (no impersonation required).
 * Currently only renders the Apify credential panel; other platform-level
 * settings can be added here in future.
 */
import { type ReactElement } from "react";
import { Link } from "react-router-dom";
import { ApifyCredentialPanel } from "../components/settings/ApifyCredentialPanel";

export function SuperAdminSettingsPage(): ReactElement {
  return (
    <div className="min-h-screen bg-[#FAFAF7]">
      <header className="flex items-center justify-between border-b bg-white px-4 py-2 sm:px-6 md:px-8">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold uppercase tracking-widest text-neutral-900">
            Dispatch
          </span>
          <span className="rounded-md bg-neutral-900 px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-white">
            Super admin
          </span>
        </div>
        <Link
          to="/admin/tenants"
          className="font-mono text-xs text-neutral-500 hover:text-neutral-900 underline underline-offset-2"
        >
          ← Tenants
        </Link>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 md:px-8">
        <p className="font-mono text-[10px] uppercase tracking-widest text-orange-800">
          Platform overview
        </p>
        <h1 className="mb-6 font-serif text-4xl text-neutral-900">Platform settings</h1>

        <ApifyCredentialPanel />
      </main>
    </div>
  );
}
