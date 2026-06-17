import type { ReactElement } from "react";
import type { StepProps } from "./wizardSteps";
import { Field, INPUT_CLASS, StepHeading } from "./fields";
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
 * (`returnTo=/admin/onboarding`). The sending email is stored in the wizard
 * data for the P14 domain flow.
 */
export function SocialStep({
  data,
  update,
  onBeforeConnect,
}: SocialStepProps): ReactElement {
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
      <div className="mt-5">
        <Field
          label="Sending email (broadcast)"
          htmlFor="wizard-from-email"
          help="You’ll verify this domain after setup. Until then the broadcast stays paused."
        >
          <input
            id="wizard-from-email"
            type="email"
            className={INPUT_CLASS}
            value={data.fromEmail ?? ""}
            placeholder="hello@theinference.com"
            onChange={(e) => {
              update({ fromEmail: e.target.value });
            }}
          />
        </Field>
      </div>
    </div>
  );
}
