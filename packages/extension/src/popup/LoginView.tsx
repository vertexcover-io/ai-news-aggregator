import { useState } from "react";
import { login } from "../lib/api";
import { setToken } from "../lib/storage";

interface Props {
  onLogin: (token: string) => void;
}

export default function LoginView({ onLogin }: Props) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { token } = await login(password);
      await setToken(token);
      onLogin(token);
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      setError(
        status === 401 ? "Incorrect password." : "Something went wrong. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="popup">
      <header className="masthead">
        <p className="eyebrow">AgentLoop</p>
        <h1 className="title">Admin</h1>
        <p className="subtitle">Sign in to add stories</p>
      </header>
      <form onSubmit={(e) => void handleSubmit(e)}>
        <div className="field">
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            className="input"
            type="password"
            required
            autoFocus
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError(null);
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
