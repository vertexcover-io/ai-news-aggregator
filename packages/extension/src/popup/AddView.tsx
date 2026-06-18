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

  if (state === "success") {
    return (
      <div style={{ padding: 16 }}>
        <p>
          {alreadyExisted
            ? "Already in the queue — no duplicate added."
            : "Added to the next newsletter run!"}
        </p>
        <button
          onClick={() => {
            setState("idle");
          }}
        >
          Add another
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>Add to Newsletter</h2>
      <form onSubmit={(e) => void handleSubmit(e)}>
        <label htmlFor="url-input" style={{ display: "block", marginBottom: 4 }}>URL</label>
        <input
          id="url-input"
          type="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
          }}
          style={{ display: "block", width: "100%", marginBottom: 8 }}
        />
        <label htmlFor="title-input" style={{ display: "block", marginBottom: 4 }}>
          Title (optional)
        </label>
        <input
          id="title-input"
          type="text"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
          }}
          style={{ display: "block", width: "100%", marginBottom: 8 }}
        />
        {errorMsg !== null && (
          <div style={{ color: "red", marginBottom: 8 }} role="alert">
            {errorMsg}
          </div>
        )}
        <button type="submit" disabled={state === "submitting"}>
          {state === "submitting" ? "Adding…" : "Add this page"}
        </button>
      </form>
      <button
        onClick={() => {
          void clearToken().then(onLogout);
        }}
        style={{ marginTop: 8, fontSize: "0.8em", cursor: "pointer" }}
      >
        Log out
      </button>
    </div>
  );
}
