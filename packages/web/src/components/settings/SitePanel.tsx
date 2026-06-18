/**
 * Site panel (Fix #3): makes the tenant's two "addresses" legible in Settings —
 * the public site URL (`<slug>.<root>`) and the default sending address
 * (`<slug>@<managed domain>`). The managed default needs no setup; a verified
 * custom sending domain (SendingDomainPanel) or custom SMTP (EmailPanel)
 * overrides the sender, and a custom web domain (WebDomainPanel) the URL.
 */
import type { ReactElement } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useSession } from "@/hooks/useSession";
import {
  MANAGED_EMAIL_DOMAIN,
  PUBLIC_ROOT_DOMAIN,
} from "../onboarding/wizardSteps";

export function SitePanel(): ReactElement | null {
  const { data } = useSession();
  // Prefer the impersonated tenant when a super_admin is acting as one.
  const tenant = data?.impersonation?.tenant ?? data?.tenant ?? null;
  const slug = tenant?.slug ?? null;
  if (slug === null) return null;

  const siteUrl = `https://${slug}.${PUBLIC_ROOT_DOMAIN}`;
  const sender = `${slug}@${MANAGED_EMAIL_DOMAIN}`;

  return (
    <Card data-testid="site-panel">
      <CardHeader>
        <CardTitle>Your site &amp; sending address</CardTitle>
        <CardDescription>
          Where your newsletter lives and who it sends from. Both work out of
          the box — bring your own domain below to customize either.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Public site</p>
          <a
            data-testid="site-url"
            href={siteUrl}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-sm underline underline-offset-2"
          >
            {siteUrl}
          </a>
        </div>
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            Default sending address
          </p>
          <p data-testid="site-sender" className="font-mono text-sm">
            {sender}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            A verified custom sending domain or SMTP provider overrides this.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
