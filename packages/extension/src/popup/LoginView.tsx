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
      setError(status === 401 ? "Invalid password" : "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>Newsletter Login</h2>
      <form onSubmit={(e) => void handleSubmit(e)}>
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
          style={{ display: "block", width: "100%", marginBottom: 8 }}
        />
        {error && (
          <div style={{ color: "red", marginBottom: 8 }} role="alert">
            {error}
          </div>
        )}
        <button type="submit" disabled={submitting}>
          {submitting ? "Logging in…" : "Log in"}
        </button>
      </form>
    </div>
  );
}
