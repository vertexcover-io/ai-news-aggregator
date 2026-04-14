import { useState, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { RunForm } from "../components/RunForm";
import { StatusPanel } from "../components/StatusPanel";
import { ResultList } from "../components/ResultList";
import { useRunPolling } from "../hooks/useRunPolling";

export function RunPage(): ReactElement {
  const [runId, setRunId] = useState<string | null>(null);
  const { data, error, isLoading } = useRunPolling(runId);
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <header>
          <h1 className="text-2xl font-bold">AI Newsletter — Run</h1>
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
                  <>
                    <ResultList items={data.rankedItems ?? []} />
                    <div className="flex justify-end">
                      <button
                        onClick={() => { void navigate(`/archive/${runId}`); }}
                        className="px-4 py-2 bg-blue-700 text-white rounded hover:bg-blue-800 text-sm font-medium"
                      >
                        View Archive
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
