/**
 * Subdomain step (REQ-033, EDGE-001/003). Live availability check against
 * GET /api/onboarding/slug-available, debounced; local format/reserved
 * pre-checks short-circuit obviously-bad input before the round-trip.
 */
import { useEffect, useState, type ReactElement } from "react";
import type { SlugAvailability } from "@newsletter/shared/types/tenant";
import {
  isReservedTenantSlug,
  isValidTenantSlugFormat,
} from "@newsletter/shared/constants/tenant";
import { checkSlugAvailable } from "../../api/onboarding";
import { PUBLIC_ROOT_DOMAIN, type StepProps } from "./wizardSteps";
import { Field, INPUT_CLASS, StepHeading } from "./fields";

const STATUS_COPY: Record<SlugAvailability, (host: string) => string> = {
  available: (host) => `${host} is available`,
  taken: (host) => `${host} is taken — pick another`,
  reserved: () => "That word is reserved and can’t be used",
  invalid: () =>
    "Invalid format — lowercase letters, numbers and hyphens only",
};

export function SlugStep({ data, update }: StepProps): ReactElement {
  const slug = (data.slug ?? "").trim().toLowerCase();

  // Cheap local pre-checks (shared P1 constants) are pure derivations; only
  // the SERVER answer lives in state, tagged with the slug it belongs to so
  // a stale response never describes the current input.
  const localStatus: SlugAvailability | null =
    slug.length === 0
      ? null
      : !isValidTenantSlugFormat(slug)
        ? "invalid"
        : isReservedTenantSlug(slug)
          ? "reserved"
          : null;
  const needsServerCheck = slug.length > 0 && localStatus === null;

  const [serverCheck, setServerCheck] = useState<{
    slug: string;
    status: SlugAvailability;
  } | null>(null);

  useEffect(() => {
    if (!needsServerCheck) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      checkSlugAvailable(slug)
        .then((res) => {
          if (!cancelled) setServerCheck({ slug, status: res.status });
        })
        .catch(() => undefined);
    }, 300);
    return (): void => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [slug, needsServerCheck]);

  const status =
    localStatus ??
    (serverCheck !== null && serverCheck.slug === slug
      ? serverCheck.status
      : null);
  const checking = needsServerCheck && status === null;
  const host = `${slug}.${PUBLIC_ROOT_DOMAIN}`;

  return (
    <div>
      <StepHeading
        step={2}
        title="Pick your address"
        blurb="Choose a subdomain. Your public newsletter lives here. You can change it later (old links redirect)."
      />
      <Field
        label="Subdomain"
        htmlFor="wizard-slug"
        help={
          <>
            Lowercase letters, numbers, and hyphens. Reserved words like{" "}
            <code>app</code>, <code>admin</code>, <code>api</code> aren’t
            allowed.
          </>
        }
      >
        <div className="flex items-stretch">
          <input
            id="wizard-slug"
            className={`${INPUT_CLASS} rounded-r-none`}
            value={data.slug ?? ""}
            placeholder="theinference"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(e) => {
              update({ slug: e.target.value.toLowerCase() });
            }}
          />
          <span className="flex items-center rounded-r-lg border border-l-0 border-[#d8d2c2] bg-[#f3efe6] px-3 font-mono text-[12.5px] text-[#6b6557]">
            .{PUBLIC_ROOT_DOMAIN}
          </span>
        </div>
      </Field>
      <p
        role="status"
        className={`mt-2 flex min-h-[20px] items-center gap-2 font-mono text-[12px] tracking-[0.04em] ${
          status === "available" ? "text-[#3a7d44]" : "text-[#a33b2a]"
        }`}
      >
        {checking ? (
          <span className="text-[#6b6557]">Checking availability…</span>
        ) : status !== null ? (
          STATUS_COPY[status](host)
        ) : null}
      </p>
    </div>
  );
}
