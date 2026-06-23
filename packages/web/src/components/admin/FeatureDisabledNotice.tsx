/**
 * Fix #4: shown to an admin who lands on a surface whose feature flag is off.
 * A warning banner naming the disabled feature + a button to Settings where it
 * can be enabled. (Admins keep their nav links, so they can always get here.)
 */
import { type ReactElement } from "react";
import { Link } from "react-router-dom";

export function FeatureDisabledNotice({
  featureLabel,
}: {
  featureLabel: string;
}): ReactElement {
  return (
    <div className="p-4 sm:p-6 md:p-8">
      <div
        role="alert"
        className="flex flex-col gap-3 rounded border border-amber-300 bg-amber-50 p-4 text-amber-900 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <p className="font-mono text-xs font-semibold uppercase tracking-widest">
            {featureLabel} is currently disabled
          </p>
          <p className="mt-1 text-sm">
            Enable it in Settings to use this feature.
          </p>
        </div>
        <Link
          to="/admin/settings"
          className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded bg-amber-900 px-4 font-mono text-xs uppercase tracking-widest text-amber-50 hover:bg-amber-800"
        >
          Enable in Settings
        </Link>
      </div>
    </div>
  );
}
