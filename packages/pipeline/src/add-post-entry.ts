/**
 * Public entry for cross-package consumers (e.g. @newsletter/api) that need the
 * add-post hydration helper without booting BullMQ workers (which the main
 * `index.ts` does as a side effect at import time).
 */
export {
  hydrateAddedPost,
  detectAddPostSourceType,
  type AddPostDeps,
  type AddPostSourceType,
} from "@pipeline/services/add-post-helper.js";

export {
  createRawItemsRepo,
  type RawItemsRepo,
  type RawItemRow,
} from "@pipeline/repositories/raw-items.js";

export {
  generateRecap,
  type RecapInputItem,
  type GenerateRecapOptions,
} from "@pipeline/processors/recap.js";

export {
  generateDigestMeta,
  type DigestMetaInputItem,
  type GenerateDigestMetaOptions,
} from "@pipeline/processors/digest-meta.js";

export {
  parseTweetIdFromUrl,
  fetchTwitterPost,
  type FetchTwitterPostDeps,
} from "@pipeline/collectors/twitter/index.js";

export { canonicalizeUrl } from "@pipeline/processors/dedup.js";
