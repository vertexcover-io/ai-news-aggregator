import { type ReactElement } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  useLinkedInOAuthStatus,
  startLinkedInOAuth,
  useTwitterOAuthStatus,
  startTwitterOAuth,
} from "../api/socialCredentials";
import { SocialConnectControls } from "./SocialConnectControls";

/**
 * P12/P13 + Fix #2: both LinkedIn and Twitter posting connect through the
 * platform's SHARED app client (super-admin-managed); each tenant only
 * connects/disconnects its OWN account via OAuth. The legacy manual Twitter
 * key form is gone — the pipeline reads the per-tenant OAuth token.
 */
function LinkedInSection(): ReactElement {
  return (
    <section data-testid="linkedin-section" className="space-y-3">
      <h3 className="text-base font-semibold">LinkedIn</h3>
      <p className="text-xs text-muted-foreground">
        Auto-posting uses the platform&apos;s shared LinkedIn app. Connect your
        LinkedIn account to publish issues to your own profile.
      </p>
      <SocialConnectControls
        platform="linkedin"
        label="LinkedIn"
        returnTo="/admin/settings"
        useStatus={useLinkedInOAuthStatus}
        start={startLinkedInOAuth}
      />
    </section>
  );
}

function TwitterSection(): ReactElement {
  return (
    <section data-testid="twitter-section" className="space-y-3">
      <h3 className="text-base font-semibold">Twitter / X</h3>
      <p className="text-xs text-muted-foreground">
        Auto-posting uses the platform&apos;s shared Twitter app. Connect your
        Twitter account to publish issues from your own handle.
      </p>
      <SocialConnectControls
        platform="twitter"
        label="Twitter / X"
        returnTo="/admin/settings"
        useStatus={useTwitterOAuthStatus}
        start={startTwitterOAuth}
      />
    </section>
  );
}

export function SocialCredentialsPanel(): ReactElement {
  return (
    <Card data-testid="social-credentials-panel">
      <CardHeader>
        <CardTitle>Social posting</CardTitle>
        <CardDescription>
          Connect LinkedIn and Twitter/X to auto-post each issue. Tokens are
          stored encrypted at rest; the shared app clients are managed by the
          platform.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <LinkedInSection />
        <Separator />
        <TwitterSection />
      </CardContent>
    </Card>
  );
}
