import { useState, type ReactElement } from "react";
import { RunForm } from "../components/RunForm";
import { StatusPanel } from "../components/StatusPanel";
import { ResultList } from "../components/ResultList";
import { useRunPolling } from "../hooks/useRunPolling";
import { useAuth } from "../auth/useAuth";

export function RunPage(): ReactElement {
  const [runId, setRunId] = useState<string | null>(null);
  const { data, error, isLoading } = useRunPolling(runId);
  const { logout } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">AI Newsletter — Run</h1>
          <button
            type="button"
            onClick={logout}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            Logout
          </button>
        </header>

        <section className="bg-white p-6 rounded shadow">
          <RunForm onSubmitted={setRunId} />
        </section>

        {runId && (
          <section className="space-y-4">
            {isLoading && <p className="text-gray-600">Loading run...</p>}
            {error && (
              <p role="alert" className="text-red-600">
                {error.message}
              </p>
            )}
            {data === null && (
              <p className="text-gray-600">
                Run not found — it may have expired. Please submit a new run.
              </p>
            )}
            {data && (
              <>
                <StatusPanel state={data} />
                {data.status === "completed" && (
                  <ResultList items={data.rankedItems ?? []} />
                )}
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
