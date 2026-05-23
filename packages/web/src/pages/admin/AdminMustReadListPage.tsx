import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { AdminMustReadEntry } from "@newsletter/shared/types";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { deleteMustRead, listAdminMustRead } from "@/api/must-read";

function excerpt(text: string, max = 80): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function AdminMustReadListPage(): ReactElement {
  const queryClient = useQueryClient();

  const listQuery = useQuery<AdminMustReadEntry[]>({
    queryKey: ["admin", "must-read"],
    queryFn: listAdminMustRead,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteMustRead(id),
    onSuccess: async () => {
      toast.success("Entry deleted");
      await queryClient.invalidateQueries({
        queryKey: ["admin", "must-read"],
      });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Delete failed";
      toast.error(message);
    },
  });

  function handleDelete(entry: AdminMustReadEntry): void {
    const ok = window.confirm(
      `Delete "${entry.title}"? This cannot be undone.`,
    );
    if (!ok) return;
    deleteMutation.mutate(entry.id);
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 md:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Must Read</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Curated canon of must-read articles surfaced on the home page.
          </p>
        </div>
        <Button asChild>
          <Link to="/admin/must-read/new">Add new</Link>
        </Button>
      </div>

      {listQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : listQuery.isError ? (
        <p className="text-sm text-red-600">
          Failed to load must-read entries.
        </p>
      ) : (listQuery.data?.length ?? 0) === 0 ? (
        <div className="rounded-lg border bg-white p-8 text-center text-sm text-muted-foreground">
          No must-read entries yet. Click “Add new” to create one.
        </div>
      ) : (
        <div className="rounded-lg border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-6 py-3">Title</TableHead>
                <TableHead className="px-6 py-3">Author</TableHead>
                <TableHead className="px-6 py-3">Year</TableHead>
                <TableHead className="px-6 py-3">Added</TableHead>
                <TableHead className="px-6 py-3">Annotation</TableHead>
                <TableHead className="px-6 py-3 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(listQuery.data ?? []).map((entry) => (
                <TableRow key={entry.id} data-entry-id={entry.id}>
                  <TableCell className="px-6 py-4 align-middle font-medium">
                    {entry.title}
                  </TableCell>
                  <TableCell className="px-6 py-4 align-middle text-sm text-muted-foreground">
                    {entry.author ?? "—"}
                  </TableCell>
                  <TableCell className="px-6 py-4 align-middle text-sm text-muted-foreground">
                    {entry.year !== null ? String(entry.year) : "—"}
                  </TableCell>
                  <TableCell className="px-6 py-4 align-middle text-sm text-muted-foreground">
                    {formatDate(entry.addedAt)}
                  </TableCell>
                  <TableCell className="px-6 py-4 align-middle text-sm text-muted-foreground">
                    {excerpt(entry.annotation)}
                  </TableCell>
                  <TableCell className="px-6 py-4 align-middle text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button asChild variant="outline" size="sm">
                        <Link to={`/admin/must-read/${entry.id}`}>Edit</Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          handleDelete(entry);
                        }}
                        disabled={deleteMutation.isPending}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </main>
  );
}
