import type { DigestMetaField, ItemTextField, PreReviewSnapshot, ReviewEditRow } from "./types.js";

export interface PatchItem {
  readonly id: number;
  readonly title?: string;
  readonly summary?: string;
  readonly bullets?: string[];
  readonly bottomLine?: string;
}

export interface ReviewPatch {
  readonly rankedItems: readonly PatchItem[];
  readonly digestHeadline?: string | null;
  readonly digestSummary?: string | null;
  readonly hook?: string | null;
  readonly twitterSummary?: string | null;
}

export function diffReview(
  snapshot: PreReviewSnapshot,
  patch: ReviewPatch,
): ReviewEditRow[] {
  const rows: ReviewEditRow[] = [];

  const snapshotIdSet = new Set(snapshot.rankedItemIds);
  const patchItems = patch.rankedItems;
  const patchIds = patchItems.map((item) => item.id);
  const patchIdSet = new Set(patchIds);

  // Build position maps (0-indexed)
  const snapshotPositionMap = new Map<number, number>(
    snapshot.rankedItemIds.map((id, i) => [id, i]),
  );
  const patchPositionMap = new Map<number, number>(
    patchIds.map((id, i) => [id, i]),
  );

  // 1. Remove: in snapshot but not in patch
  for (const id of snapshot.rankedItemIds) {
    if (!patchIdSet.has(id)) {
      rows.push({
        editType: "remove",
        rawItemId: id,
        field: null,
        before: null,
        after: null,
        positionBefore: snapshotPositionMap.get(id) ?? null,
        positionAfter: null,
      });
    }
  }

  // 2. Add: in patch but not in snapshot
  for (const id of patchIds) {
    if (!snapshotIdSet.has(id)) {
      rows.push({
        editType: "add",
        rawItemId: id,
        field: null,
        before: null,
        after: null,
        positionBefore: null,
        positionAfter: patchPositionMap.get(id) ?? null,
      });
    }
  }

  // 3. Reorder: in both but at different positions
  for (const id of patchIds) {
    if (!snapshotIdSet.has(id)) continue; // already handled as add
    const posBefore = snapshotPositionMap.get(id);
    const posAfter = patchPositionMap.get(id);
    if (posBefore !== posAfter) {
      rows.push({
        editType: "reorder",
        rawItemId: id,
        field: "rank",
        before: posBefore ?? null,
        after: posAfter ?? null,
        positionBefore: posBefore ?? null,
        positionAfter: posAfter ?? null,
      });
    }
  }

  // 4. Text edits on item recap fields
  for (const patchItem of patchItems) {
    if (!snapshotIdSet.has(patchItem.id)) continue; // add — no recap to compare
    const snapRecap = snapshot.recap[patchItem.id];

    const itemTextFields: ItemTextField[] = ["title", "summary", "bullets", "bottomLine"];
    for (const field of itemTextFields) {
      if (!(field in patchItem)) continue; // no override on this ref — preserve LLM text
      const patchValue = patchItem[field];
      const snapValue = snapRecap[field];

      // For arrays (bullets), compare by JSON serialization
      const patchStr = Array.isArray(patchValue) ? JSON.stringify(patchValue) : patchValue;
      const snapStr = Array.isArray(snapValue) ? JSON.stringify(snapValue) : snapValue;

      if (patchStr !== snapStr) {
        rows.push({
          editType: "text_edit",
          rawItemId: patchItem.id,
          field,
          before: snapValue,
          after: patchValue,
          positionBefore: null,
          positionAfter: null,
        });
      }
    }
  }

  // 5. Digest meta text edits
  const digestFieldMap: [keyof ReviewPatch, DigestMetaField, keyof PreReviewSnapshot["digestMeta"]][] = [
    ["digestHeadline", "digest_headline", "headline"],
    ["digestSummary", "digest_summary", "summary"],
    ["hook", "hook", "hook"],
    ["twitterSummary", "twitter_summary", "twitterSummary"],
  ];

  for (const [patchKey, fieldName, snapKey] of digestFieldMap) {
    if (!(patchKey in patch)) continue; // not provided — preserve existing
    const patchValue = patch[patchKey];
    const snapValue = snapshot.digestMeta[snapKey];
    if (patchValue !== snapValue) {
      rows.push({
        editType: "text_edit",
        rawItemId: null,
        field: fieldName,
        before: snapValue,
        after: patchValue,
        positionBefore: null,
        positionAfter: null,
      });
    }
  }

  return rows;
}
