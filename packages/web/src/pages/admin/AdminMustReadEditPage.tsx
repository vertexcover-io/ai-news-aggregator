import { useState, type ReactElement } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { AdminMustReadEntry } from "@newsletter/shared/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DuplicateUrlError,
  createMustRead,
  listAdminMustRead,
  previewMustRead,
  updateMustRead,
} from "@/api/must-read";
import {
  MustReadEntryForm,
  type MustReadFormValues,
} from "@/components/admin/must-read/MustReadEntryForm";

type FormState =
  | { kind: "idle" }
  | { kind: "previewing" }
  | {
      kind: "editing";
      values: MustReadFormValues;
      banner: ReactElement | null;
      resyncKey: string;
    }
  | { kind: "saving"; values: MustReadFormValues; resyncKey: string };

const emptyValues: MustReadFormValues = {
  title: "",
  author: null,
  year: null,
  annotation: "",
};

function entryToValues(entry: AdminMustReadEntry): MustReadFormValues {
  return {
    title: entry.title,
    author: entry.author,
    year: entry.year,
    annotation: entry.annotation,
  };
}

function newResyncKey(): string {
  return `${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`;
}

interface CreateFlowProps {
  onCreated: () => void;
}

function CreateFlow({ onCreated }: CreateFlowProps): ReactElement {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<FormState>({ kind: "idle" });
  const [duplicateId, setDuplicateId] = useState<string | null>(null);

  const previewMutation = useMutation({
    mutationFn: (input: { url: string }) => previewMustRead(input),
    onMutate: () => {
      setDuplicateId(null);
      setState({ kind: "previewing" });
    },
    onSuccess: (result) => {
      if (result.status === "extracted") {
        setState({
          kind: "editing",
          values: {
            title: result.suggested.title,
            author: result.suggested.author,
            year: result.suggested.year,
            annotation: "",
          },
          banner: null,
          resyncKey: newResyncKey(),
        });
      } else {
        setState({
          kind: "editing",
          values: emptyValues,
          banner: (
            <p
              role="alert"
              className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800"
            >
              Extraction failed: {result.error}. Enter manually.
            </p>
          ),
          resyncKey: newResyncKey(),
        });
      }
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Preview failed";
      toast.error(message);
      setState({
        kind: "editing",
        values: emptyValues,
        banner: (
          <p
            role="alert"
            className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            Preview failed: {message}. Enter manually.
          </p>
        ),
        resyncKey: newResyncKey(),
      });
    },
  });

  const createMutation = useMutation({
    mutationFn: createMustRead,
    onSuccess: () => {
      toast.success("Entry created");
      onCreated();
    },
    onError: (err: unknown, variables) => {
      if (err instanceof DuplicateUrlError) {
        setDuplicateId(err.existingId);
        setState({
          kind: "editing",
          values: {
            title: variables.title,
            author: variables.author,
            year: variables.year,
            annotation: variables.annotation,
          },
          banner: null,
          resyncKey: newResyncKey(),
        });
        return;
      }
      const message = err instanceof Error ? err.message : "Save failed";
      toast.error(message);
      setState({
        kind: "editing",
        values: {
          title: variables.title,
          author: variables.author,
          year: variables.year,
          annotation: variables.annotation,
        },
        banner: (
          <p
            role="alert"
            className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {message}
          </p>
        ),
        resyncKey: newResyncKey(),
      });
    },
  });

  function handlePreview(): void {
    const trimmed = url.trim();
    if (trimmed === "") return;
    previewMutation.mutate({ url: trimmed });
  }

  function handleSave(values: MustReadFormValues): void {
    setState({ kind: "saving", values, resyncKey: newResyncKey() });
    createMutation.mutate({
      url: url.trim(),
      title: values.title,
      author: values.author,
      year: values.year,
      annotation: values.annotation,
    });
  }

  const isPreviewing = state.kind === "previewing";
  const isSaving = state.kind === "saving";
  const showForm = state.kind === "editing" || state.kind === "saving";
  const formValues =
    state.kind === "editing" || state.kind === "saving"
      ? state.values
      : emptyValues;
  const resyncKey =
    state.kind === "editing" || state.kind === "saving"
      ? state.resyncKey
      : "init";
  const banner = state.kind === "editing" ? state.banner : null;

  const duplicateBanner = duplicateId ? (
    <p role="alert" className="text-sm text-red-700">
      URL already exists.{" "}
      <Link
        to={`/admin/must-read/${duplicateId}`}
        className="underline underline-offset-2"
      >
        View existing entry
      </Link>
      .
    </p>
  ) : null;

  return (
    <div className="space-y-6">
      <div className="space-y-2 rounded-lg border bg-white p-4">
        <label htmlFor="must-read-url" className="text-sm font-medium">
          URL
        </label>
        <div className="flex items-center gap-2">
          <Input
            id="must-read-url"
            type="url"
            placeholder="https://example.com/article"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
            }}
            disabled={isPreviewing || isSaving}
            className="flex-1"
          />
          <Button
            type="button"
            onClick={handlePreview}
            disabled={url.trim() === "" || isPreviewing || isSaving}
          >
            Preview
          </Button>
        </div>
        {isPreviewing ? (
          <p className="text-sm text-muted-foreground">Extracting…</p>
        ) : null}
        {duplicateBanner}
      </div>

      {showForm ? (
        <div className="rounded-lg border bg-white p-4">
          <MustReadEntryForm
            defaultValues={formValues}
            onSubmit={handleSave}
            saving={isSaving}
            disabled={isPreviewing}
            banner={banner}
            resyncKey={resyncKey}
          />
        </div>
      ) : (
        <MustReadEntryForm
          defaultValues={emptyValues}
          onSubmit={handleSave}
          saving={false}
          disabled={true}
          resyncKey="placeholder"
        />
      )}
    </div>
  );
}

interface EditFlowProps {
  entry: AdminMustReadEntry;
  onSaved: () => void;
}

function EditFlow({ entry, onSaved }: EditFlowProps): ReactElement {
  const initial = entryToValues(entry);

  const updateMutation = useMutation({
    mutationFn: (values: MustReadFormValues) =>
      updateMustRead(entry.id, {
        url: entry.url,
        title: values.title,
        author: values.author,
        year: values.year,
        annotation: values.annotation,
      }),
    onSuccess: () => {
      toast.success("Entry updated");
      onSaved();
    },
    onError: (err: unknown) => {
      if (err instanceof DuplicateUrlError) {
        toast.error("This URL already exists on another entry.");
        return;
      }
      const message = err instanceof Error ? err.message : "Save failed";
      toast.error(message);
    },
  });

  function handleSave(values: MustReadFormValues): void {
    updateMutation.mutate(values);
  }

  return (
    <div className="rounded-lg border bg-white p-4 space-y-4">
      <div className="space-y-1">
        <label className="text-sm font-medium">URL</label>
        <Input type="url" value={entry.url} disabled readOnly />
      </div>
      <MustReadEntryForm
        defaultValues={initial}
        onSubmit={handleSave}
        saving={updateMutation.isPending}
        resyncKey={entry.id}
      />
    </div>
  );
}

export function AdminMustReadEditPage(): ReactElement {
  const params = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const isNew = !params.id;

  const listQuery = useQuery<AdminMustReadEntry[]>({
    queryKey: ["admin", "must-read"],
    queryFn: listAdminMustRead,
    enabled: !isNew,
  });

  function backToList(): void {
    void queryClient.invalidateQueries({ queryKey: ["admin", "must-read"] });
    void navigate("/admin/must-read");
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6 md:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {isNew ? "New must-read" : "Edit must-read"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isNew
              ? "Paste a URL to extract metadata, then write your annotation."
              : "Update fields and save."}
          </p>
        </div>
        <Link
          to="/admin/must-read"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Back to list
        </Link>
      </div>

      {isNew ? (
        <CreateFlow onCreated={backToList} />
      ) : listQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : listQuery.isError ? (
        <p className="text-sm text-red-600">Failed to load entry.</p>
      ) : (() => {
          const entry =
            listQuery.data?.find((e) => e.id === params.id) ?? null;
          if (!entry) {
            return (
              <p className="text-sm text-red-600">Entry not found.</p>
            );
          }
          return <EditFlow entry={entry} onSaved={backToList} />;
        })()}
    </main>
  );
}
