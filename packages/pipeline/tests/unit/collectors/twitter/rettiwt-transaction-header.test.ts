import { describe, it, expect } from "vitest";
// Deep import into the (pnpm-patched) rettiwt-api dist. No published types for this
// internal module, so we describe only the surface this test exercises.
// @ts-expect-error -- internal module, no type declarations
import { FetcherService } from "rettiwt-api/dist/services/public/FetcherService.js";

interface TransactionHeaderProbe {
  _handleXMigration: () => Promise<unknown>;
  _getTransactionHeader: (
    method: string,
    url: string,
  ) => Promise<Record<string, string>>;
}

/**
 * Regression guard for the newsletter pnpm patch on rettiwt-api.
 *
 * X migrated their web build (June 2026) and moved `x-client-transaction-id`
 * generation into an obfuscated, per-deploy-rotated signer. The bundled
 * `x-client-transaction-id` library can no longer resolve the ondemand chunk and
 * throws `OnDemandFileUrlResolutionError`. Unpatched, rettiwt lets that bubble up,
 * surfacing as "Unknown error" / HTTP 502 on Add-a-post and as silent collector
 * failures. X does not actually require the header for authenticated reads, so the
 * patch makes header generation fail-soft: on any failure, send the request WITHOUT
 * the header instead of throwing.
 */
describe("rettiwt _getTransactionHeader fail-soft patch", () => {
  it("returns an empty header (does not throw) when the transaction id cannot be generated", async () => {
    // Bare instance: skip the constructor, stub the homepage fetch so there is no
    // network. The stub document has no usable runtime, so the underlying
    // ClientTransaction.create throws exactly as it does against X's new build.
    const svc = Object.create(FetcherService.prototype) as TransactionHeaderProbe;
    svc._handleXMigration = (): Promise<unknown> =>
      Promise.resolve({
        querySelectorAll: () => [],
        documentElement: { outerHTML: "" },
      });

    const header = await svc._getTransactionHeader(
      "GET",
      "https://x.com/i/api/graphql/abc/TweetResultByRestId",
    );

    expect(header).toEqual({});
  });
});
