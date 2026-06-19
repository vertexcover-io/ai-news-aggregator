import { useState } from "react";
import { login } from "../lib/api";
import { setToken } from "../lib/storage";

interface Props {
  onLogin: (token: string) => void;
}

export default function LoginView({ onLogin }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { token } = await login(email, password);
      await setToken(token);
      onLogin(token);
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status === 401) {
        setError("Incorrect email or password.");
      } else if (status === 403) {
        // Super-admins have no implicit tenant (v1): they pick one in the web app.
        const message = err instanceof Error ? err.message : "";
        setError(
          message.length > 0
            ? message
            : "Choose a tenant in the web app before using the extension.",
        );
      } else {
        setError("Something went wrong. Try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const clearError = () => {
    if (error) setError(null);
  };

  return (
    <div className="popup">
      <header className="masthead">
        <p className="eyebrow">AgentLoop Collector</p>
        <h1 className="title">Sign in</h1>
        <p className="subtitle">Add stories to your newsletter</p>
      </header>
      <form onSubmit={(e) => void handleSubmit(e)}>
        <div className="field">
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="input"
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              clearError();
            }}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            className="input"
            type="password"
            required
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              clearError();
            }}
          />
        </div>
        {error !== null && (
          <p className="error" role="alert" aria-live="polite">
            {error}
          </p>
        )}
        <button className="btn" type="submit" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
