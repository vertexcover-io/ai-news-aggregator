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
