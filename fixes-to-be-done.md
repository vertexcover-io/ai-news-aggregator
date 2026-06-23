# Fixes to Be Done

## 1. Branding Information in Admin Settings

### Issue

Branding-related information configured during onboarding is not visible in the Admin Settings page.

### Expected Behavior

The admin should be able to view and manage all branding information configured during onboarding, including:

* Newsletter Name
* Headline
* Sub-tagline
* Logo
* Brand Colors
* Any other branding-related metadata

---

## 2. Social Posting Authentication

### LinkedIn

* Authentication should be OAuth-based.
* Remove any key-based authentication approach if present.

### Twitter/X

* Current implementation appears to use an older key-based authentication flow.
* Replace it with a proper OAuth-based authentication flow.

### Expected Behavior

Admins should be able to connect and manage their LinkedIn and Twitter/X accounts through OAuth authorization.

---

## 3. Subdomain & Email Setup Experience

### Issue

The current subdomain and email setup process is difficult to understand.

### Questions That Must Be Clearly Addressed

* How can users bring their own email provider for newsletter delivery?
* How is email delivery configured and verified?
* How do tenant-specific subdomains work? Ideally the user should be able to bringg their own domain to setup but for now lets just focus on our domain and provide the user with subdomain that they set during the onboarding process.
* What DNS records are required?
* What steps are required to activate a custom sending domain?

### Expected Behavior

Provide a clear onboarding/setup flow with documentation and validation steps.

---

## 4. Feature Flag Enforcement

### Affected Features

* Eval
* Deliverability
* Canon Pages

### Issue

These features do not respect Admin Settings.

### Expected Behavior

#### User-Facing Side

If a feature is disabled:

* Users should not see the feature.
* Users should not see related pages in archives.
* Users should not be able to access related routes.

#### Admin Side

If an admin directly visits a disabled feature route:

* Display a warning banner at the top of the page.
* Show a message indicating that the feature is currently disabled.
* Provide a button that redirects the admin to the Settings page where the feature can be enabled.

---

## 5. Remove Default Collector Sources

### Issue

Default sources are preconfigured for collectors.

### Remove Defaults Such As

* Anthropic Blog
* Default Hacker News keywords
* Any other pre-populated collector sources

### Expected Behavior

New tenants should start with no default collector sources configured.

---

## 6. Collector Check Failure

### Issue

When running collector checks individually, all collectors except Hacker News return the following error:

```text
not configured — add sources at /admin/settings
```

### Expected Behavior

* Collector checks should function correctly once sources are configured.
* Error messaging should clearly indicate missing configuration details.
* Verify why only the Hacker News collector is functioning correctly.

---

## 7. Tenant Subdomain Serving

### Issue

Tenant subdomains are not being served correctly.

### Expected Behavior

* Each tenant subdomain should resolve correctly.
* Tenant-specific content should be served based on the requested subdomain.
* Routing, SSL, and DNS handling should function properly across all tenant subdomains.

## 8. Product Landing Page

### Issue

There is currently no public home page or landing page for the product.

### Expected Behavior

A proper landing page should be implemented that clearly communicates:

* What the product does
* Key features and benefits
* Target audience
* Sign up / Get Started CTA
* Product screenshots or demos
* Customer testimonials (if available)
* Documentation and support links

### Additional Requirements

* The landing page should follow the configured branding settings.
* Tenant-specific branding should be reflected where applicable.
* The page should be optimized for SEO and social sharing.
* Navigation should provide clear access to login, signup, and documentation.
