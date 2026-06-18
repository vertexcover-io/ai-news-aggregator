import { useEffect, useState } from "react";
import { submit } from "../lib/api";
import { clearToken } from "../lib/storage";

interface Props {
  token: string;
  onLogout: () => void;
}

type State = "idle" | "submitting" | "success" | "error";

export default function AddView({ token, onLogout }: Props) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [state, setState] = useState<State>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [alreadyExisted, setAlreadyExisted] = useState(false);

  useEffect(() => {
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then((tabs) => {
        if (tabs.length > 0) {
          setUrl(tabs[0].url ?? "");
          setTitle(tabs[0].title ?? "");
        }
      })
      .catch(() => {
        // unable to query tab — leave fields empty
      });
  }, []);

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setState("submitting");
    try {
      const res = await submit(url, title.length > 0 ? title : undefined, token);
      setAlreadyExisted(res.alreadyExisted);
      setState("success");
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status === 401) {
        await clearToken();
        onLogout();
        return;
      }
      const msg = err instanceof Error ? err.message : "Submit failed";
      setErrorMsg(msg);
      setState("error");
    }
  };

  const handleLogout = () => {
    void clearToken().then(onLogout);
  };

  if (state === "success") {
    return (
      <div className="popup">
        <div className="success">
          <div className="success-mark" aria-hidden="true">
            ✓
          </div>
          <p className="success-title">
            {alreadyExisted ? "Already in the queue" : "Added to the next issue"}
          </p>
          <p className="success-note">
            {alreadyExisted
              ? "This story is already queued — no duplicate added."
              : "It’ll be considered for tomorrow’s newsletter."}
          </p>
          <button
            className="btn"
            onClick={() => {
              setState("idle");
            }}
          >
            Add another
          </button>
        </div>
        <div className="footer">
          <button className="btn btn-ghost" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="popup">
      <header className="masthead">
        <p className="eyebrow">The Daily Read</p>
        <h1 className="title">Add a Story</h1>
        <p className="subtitle">Queue this page for tomorrow</p>
      </header>
      <form onSubmit={(e) => void handleSubmit(e)}>
        <div className="field">
          <label className="label" htmlFor="url-input">
            URL
          </label>
          <input
            id="url-input"
            className="input"
            type="url"
            required
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
            }}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="title-input">
            Title (optional)
          </label>
          <textarea
            id="title-input"
            className="input"
            rows={2}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
            }}
          />
        </div>
        {errorMsg !== null && (
          <p className="error" role="alert" aria-live="polite">
            {errorMsg}
          </p>
        )}
        <button className="btn" type="submit" disabled={state === "submitting"}>
          {state === "submitting" ? "Adding…" : "Add this page"}
        </button>
      </form>
      <div className="footer">
        <button className="btn btn-ghost" onClick={handleLogout}>
          Log out
        </button>
      </div>
    </div>
  );
}
