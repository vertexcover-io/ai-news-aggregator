export interface PublicMustReadEntry {
  id: string;
  url: string;
  title: string;
  author: string | null;
  year: number | null;
  annotation: string;
  addedAt: string;
}

export interface AdminMustReadEntry extends PublicMustReadEntry {
  updatedAt: string;
}

export interface MustReadPreviewSuggested {
  title: string;
  author: string | null;
  year: number | null;
}

export type MustReadPreviewResponse =
  | { status: "extracted"; suggested: MustReadPreviewSuggested }
  | { status: "extraction_failed"; error: string };

export interface MustReadCreateBody {
  url: string;
  title: string;
  author: string | null;
  year: number | null;
  annotation: string;
}

export type MustReadPatchBody = Partial<MustReadCreateBody>;
