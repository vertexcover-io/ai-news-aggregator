import type { ReactElement } from "react";
import { managedSenderFor, type StepProps } from "./wizardSteps";
import { StepHeading } from "./fields";
import { SocialConnectControls } from "../SocialConnectControls";
import {
  useLinkedInOAuthStatus,
  startLinkedInOAuth,
  useTwitterOAuthStatus,
  startTwitterOAuth,
} from "../../api/socialCredentials";

interface SocialStepProps extends StepProps {
  /**
   * Persist the wizard draft before an OAuth redirect leaves the page, so the
   * round-trip resumes on this step with the tenant's input intact (Fix #2).
   */
  onBeforeConnect?: () => Promise<void>;
}

/**
 * Connect channels step. LinkedIn / X connect via OAuth through the shared app
 * clients (P12/P13); the connect flow redirects out and resumes here
 * (`returnTo=/admin/onboarding`). Email sends from a managed default
 * (`<slug>@<managed domain>`) with zero config — shown read-only here; a tenant
 * can bring their own sending domain or SMTP provider later in Settings (Fix #3).
 */
export function SocialStep({
  data,
  onBeforeConnect,
}: SocialStepProps): ReactElement {
  const slug = (data.slug ?? "").trim().toLowerCase();
  const sender = slug.length > 0 ? managedSenderFor(slug) : null;
  return (
    <div>
      <StepHeading
        step={6}
        title="Connect channels"
        blurb="Optional — connect where you’ll publish. You can do all of this later from Settings."
      />
      <div className="space-y-4">
        <div className="rounded-xl border border-[#e7e2d6] px-4 py-3.5">
          <span className="mb-2 block text-[14px] font-semibold text-[#14110d]">
            LinkedIn
          </span>
          <SocialConnectControls
            platform="linkedin"
            label="LinkedIn"
            returnTo="/admin/onboarding"
            useStatus={useLinkedInOAuthStatus}
            start={startLinkedInOAuth}
            onBeforeConnect={onBeforeConnect}
          />
        </div>
        <div className="rounded-xl border border-[#e7e2d6] px-4 py-3.5">
          <span className="mb-2 block text-[14px] font-semibold text-[#14110d]">
            Twitter / X
          </span>
          <SocialConnectControls
            platform="twitter"
            label="Twitter / X"
            returnTo="/admin/onboarding"
            useStatus={useTwitterOAuthStatus}
            start={startTwitterOAuth}
            onBeforeConnect={onBeforeConnect}
          />
        </div>
      </div>
      <div className="mt-5 rounded-xl border border-[#e7e2d6] bg-[#faf8f2] px-4 py-3.5">
        <span className="mb-1 block text-[14px] font-semibold text-[#14110d]">
          Sending email
        </span>
        <p
          data-testid="onboarding-sender"
          className="font-mono text-[13px] text-[#14110d]"
        >
          {sender ?? "Pick a subdomain first to see your sending address"}
        </p>
        <p className="mt-1 text-[12.5px] text-[#6b6557]">
          Your newsletter sends from this address by default — no setup needed.
          You can bring your own sending domain or email provider later in
          Settings.
        </p>
      </div>
    </div>
  );
}
